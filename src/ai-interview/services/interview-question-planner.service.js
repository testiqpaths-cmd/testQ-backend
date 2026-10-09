import crypto from "crypto";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { aiQuestionService } from "../ai/ai-question.service.js";
import { questionBankService } from "./question-bank.service.js";
import { questionAudioService } from "../tts/question-audio.service.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { resolveInterviewTypeForTopic } from "../constants/interview-types.js";
import logger from "../../config/logger.js";

const MIN_READY = 3;
const TARGET_READY = 5;
const LOCK_TTL_MS = 45000; // 45 seconds
const CLAIM_TTL_MS = 30000; // 30 seconds claim lease TTL

function hashQuestion(text) {
  const norm = String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(norm).digest("hex");
}

export class InterviewQuestionPlannerService {
  constructor(ai = aiQuestionService) {
    this.ai = ai;
  }

  /**
   * Recovers any CLAIMED questions whose claim lease has expired back to READY.
   * Ensures that process crashes or network aborts do not permanently orphan questions.
   *
   * @param {string|Types.ObjectId} sessionId
   * @returns {Promise<number>} Number of recovered questions
   */
  async recoverStaleClaims(sessionId) {
    if (!sessionId) return 0;
    try {
      const now = new Date();
      const res = await InterviewSession.updateOne(
        {
          _id: sessionId,
          preparedQuestions: {
            $elemMatch: {
              status: "CLAIMED",
              claimExpiresAt: { $lt: now },
            },
          },
        },
        {
          $set: {
            "preparedQuestions.$[elem].status": "READY",
            "preparedQuestions.$[elem].claimOwner": null,
            "preparedQuestions.$[elem].claimExpiresAt": null,
            "preparedQuestions.$[elem].claimedAt": null,
          },
        },
        {
          arrayFilters: [
            { "elem.status": "CLAIMED", "elem.claimExpiresAt": { $lt: now } },
          ],
        }
      );

      const count = res?.modifiedCount || 0;
      if (count > 0) {
        logger.info(
          `[QuestionPlanner] Recovered ${count} stale claimed question(s) back to READY in session ${sessionId}`
        );
      }
      return count;
    } catch (err) {
      logger.warn(
        `[QuestionPlanner] Error recovering stale claims for session ${sessionId}: ${err.message}`
      );
      return 0;
    }
  }

  /**
   * Explicitly releases a claimed question back to READY (e.g. if turn creation fails).
   *
   * @param {string|Types.ObjectId} sessionId
   * @param {string} questionId
   */
  async releaseClaim(sessionId, questionId) {
    if (!sessionId || !questionId) return;
    try {
      await InterviewSession.updateOne(
        {
          _id: sessionId,
          "preparedQuestions.questionId": questionId,
          "preparedQuestions.status": "CLAIMED",
        },
        {
          $set: {
            "preparedQuestions.$.status": "READY",
            "preparedQuestions.$.claimOwner": null,
            "preparedQuestions.$.claimExpiresAt": null,
            "preparedQuestions.$.claimedAt": null,
          },
        }
      );
      logger.info(
        `[QuestionPlanner] Released claim on question ${questionId} back to READY in session ${sessionId}`
      );
    } catch (err) {
      logger.warn(
        `[QuestionPlanner] Error releasing claim on question ${questionId}: ${err.message}`
      );
    }
  }

  /**
   * Atomically claims a READY prepared question from the session pool.
   * Uses atomic findOneAndUpdate with $elemMatch to eliminate race conditions.
   * Enforces a time-limited claim lease (CLAIM_TTL_MS) to enable automatic stale claim recovery.
   *
   * @param {string|Types.ObjectId} sessionId
   * @param {Object} criteria
   * @param {string} criteria.topic
   * @param {string} [criteria.difficulty]
   * @param {string} [criteria.owner]
   * @returns {Promise<Object|null>} The claimed question object or null if none available.
   */
  async claimPreparedQuestion(sessionId, { topic, difficulty, owner = null }) {
    if (!sessionId || !topic) return null;

    // 0. Auto-recover any stale claims whose lease expired
    await this.recoverStaleClaims(sessionId);

    const normTopic = String(topic).toUpperCase();
    const normDiff = difficulty ? String(difficulty).toUpperCase() : null;
    const now = new Date();
    const claimOwner = owner || crypto.randomBytes(6).toString("hex");
    const claimExpiresAt = new Date(now.getTime() + CLAIM_TTL_MS);

    // 1. First priority: Exact topic + Exact difficulty match
    let filter = {
      _id: sessionId,
      preparedQuestions: {
        $elemMatch: {
          topic: normTopic,
          ...(normDiff ? { difficulty: normDiff } : {}),
          status: "READY",
        },
      },
    };

    let update = {
      $set: {
        "preparedQuestions.$.status": "CLAIMED",
        "preparedQuestions.$.claimedAt": now,
        "preparedQuestions.$.claimOwner": claimOwner,
        "preparedQuestions.$.claimExpiresAt": claimExpiresAt,
      },
    };

    let exactMatched = false;
    let doc = await InterviewSession.findOneAndUpdate(filter, update, { returnDocument: "before" });
    if (doc) {
      exactMatched = Boolean(normDiff);
    } else if (normDiff) {
      // 2. Second priority: If no exact difficulty matched, claim any READY question for requested topic
      filter = {
        _id: sessionId,
        preparedQuestions: {
          $elemMatch: {
            topic: normTopic,
            status: "READY",
          },
        },
      };
      doc = await InterviewSession.findOneAndUpdate(filter, update, { returnDocument: "before" });
    }

    if (!doc || !Array.isArray(doc.preparedQuestions)) {
      return null;
    }

    // Identify the exact question that was matched and claimed
    const claimed = doc.preparedQuestions.find((q) => {
      if (q.status !== "READY") return false;
      if (q.topic?.toUpperCase() !== normTopic) return false;
      if (exactMatched) {
        return q.difficulty?.toUpperCase() === normDiff;
      }
      return true;
    });

    if (claimed) {
      const claimedObj = claimed.toObject ? claimed.toObject() : { ...claimed };
      logger.info(
        `[QuestionPlanner] Atomically CLAIMED question ${claimed.questionId} for session ${sessionId} (topic: ${claimed.topic}, diff: ${claimed.difficulty}, owner: ${claimOwner})`
      );
      return {
        ...claimedObj,
        status: "CLAIMED",
        claimedAt: now,
        claimOwner,
        claimExpiresAt,
      };
    }

    return null;
  }

  /**
   * Marks a previously CLAIMED question as USED.
   *
   * @param {string|Types.ObjectId} sessionId
   * @param {string} questionId
   */
  async markQuestionUsed(sessionId, questionId) {
    if (!sessionId || !questionId) return;

    try {
      await InterviewSession.updateOne(
        {
          _id: sessionId,
          "preparedQuestions.questionId": questionId,
        },
        {
          $set: {
            "preparedQuestions.$.status": "USED",
            "preparedQuestions.$.usedAt": new Date(),
            "preparedQuestions.$.claimExpiresAt": null,
          },
        }
      );
    } catch (err) {
      logger.warn(`[QuestionPlanner] Error marking question ${questionId} as USED: ${err.message}`);
    }
  }

  /**
   * Discards a prepared question (e.g. topic skipped or invalid).
   *
   * @param {string|Types.ObjectId} sessionId
   * @param {string} questionId
   */
  async discardQuestion(sessionId, questionId) {
    if (!sessionId || !questionId) return;

    try {
      await InterviewSession.updateOne(
        {
          _id: sessionId,
          "preparedQuestions.questionId": questionId,
        },
        {
          $set: {
            "preparedQuestions.$.status": "DISCARDED",
            "preparedQuestions.$.claimExpiresAt": null,
          },
        }
      );
    } catch (err) {
      logger.warn(`[QuestionPlanner] Error discarding question ${questionId}: ${err.message}`);
    }
  }

  /**
   * Checks the pool count for READY questions in the session.
   *
   * @param {string|Types.ObjectId} sessionId
   * @returns {Promise<{ readyCount: number, totalCount: number, readyByTopic: Record<string, number> }>}
   */
  async getPoolStatus(sessionId) {
    const session = await InterviewSession.findById(sessionId).select("preparedQuestions").lean();
    if (!session || !Array.isArray(session.preparedQuestions)) {
      return { readyCount: 0, totalCount: 0, readyByTopic: {} };
    }

    const readyByTopic = {};
    let readyCount = 0;

    for (const q of session.preparedQuestions) {
      if (q.status === "READY") {
        readyCount++;
        const t = (q.topic || "UNKNOWN").toUpperCase();
        readyByTopic[t] = (readyByTopic[t] || 0) + 1;
      }
    }

    return {
      readyCount,
      totalCount: session.preparedQuestions.length,
      readyByTopic,
    };
  }

  /**
   * Background Replenishment Layer:
   * Ensures the session maintains 3–5 structured READY questions ahead.
   * Implements session-level concurrency lock to prevent parallel generation.
   *
   * @param {string|Types.ObjectId} sessionId
   * @returns {Promise<void>}
   */
  async replenishPool(sessionId) {
    if (!sessionId) return;

    const now = new Date();
    const lockOwner = crypto.randomBytes(6).toString("hex");
    const lockUntil = new Date(now.getTime() + LOCK_TTL_MS);

    // 1. Acquire Idempotency Lock
    const acquired = await InterviewSession.findOneAndUpdate(
      {
        _id: sessionId,
        $or: [
          { "poolGenerationLock.lockedUntil": null },
          { "poolGenerationLock.lockedUntil": { $lt: now } },
        ],
      },
      {
        $set: {
          poolGenerationLock: {
            lockedUntil: lockUntil,
            owner: lockOwner,
          },
        },
      },
      { returnDocument: "after" }
    );

    if (!acquired) {
      logger.info(`[QuestionPlanner] Session ${sessionId} replenishment already running. Skipping duplicate invocation.`);
      return;
    }

    try {
      // Auto-recover any stale claims before evaluating replenishment budget
      await this.recoverStaleClaims(sessionId);

      const session = await InterviewSession.findById(sessionId);
      if (!session) return;

      // Abort if session is in terminal state
      const terminalStates = ["COMPLETED", "CANCELLED", "EXPIRED"];
      if (terminalStates.includes(session.interviewState)) {
        return;
      }

      const plan = await InterviewPlan.findById(session.planId);
      const readyQuestions = (session.preparedQuestions || []).filter((q) => q.status === "READY");

      if (readyQuestions.length >= TARGET_READY) {
        return;
      }

      const neededCount = TARGET_READY - readyQuestions.length;
      logger.info(
        `[QuestionPlanner] Replenishing pool for session ${session.interviewId}: currently ${readyQuestions.length} READY, generating ${neededCount} ahead.`
      );

      // Collect previously asked and prepared questions to prevent duplicates
      const pastTurns = await InterviewTurn.find({ sessionId: session._id })
        .select("question concept topic")
        .lean();

      const existingTexts = new Set(pastTurns.map((t) => t.question).filter(Boolean));
      const existingConcepts = new Set(pastTurns.map((t) => t.concept).filter(Boolean));
      const existingHashes = new Set(
        (session.preparedQuestions || []).map((q) => q.questionHash).filter(Boolean)
      );

      session.preparedQuestions.forEach((q) => {
        if (q.question) existingTexts.add(q.question);
        if (q.concept) existingConcepts.add(q.concept);
      });

      // Determine structured topic & difficulty queue based on blueprint
      const candidateTopics = this.determineTopicsToBuffer(session, plan, pastTurns);

      let generatedThisPass = 0;

      for (const target of candidateTopics) {
        if (generatedThisPass >= neededCount) break;

        // Check if session became terminal during generation
        const checkSession = await InterviewSession.findById(session._id)
          .select("interviewState")
          .lean();
        if (!checkSession || terminalStates.includes(checkSession.interviewState)) {
          break;
        }

        const qInterviewType = resolveInterviewTypeForTopic(target.topic, session.interviewTypes);

        try {
          const aiOutput = await this.ai.generateQuestion({
            role: session.role,
            experienceLevel: session.experienceLevel,
            topic: target.topic,
            difficulty: target.difficulty,
            previousQuestions: Array.from(existingTexts),
            conceptsAlreadyTested: Array.from(existingConcepts),
            resumeSkills: session.resumeData?.extracted?.skills || session.techStack || [],
            interviewType: qInterviewType,
            interviewId: session.interviewId,
          });

          if (!aiOutput || !aiOutput.question) continue;

          const qText = aiOutput.question.trim();
          const qHash = hashQuestion(qText);

          // Check if hash collides with any already prepared or asked question
          if (existingHashes.has(qHash) || existingTexts.has(qText)) {
            logger.info(
              `[QuestionPlanner] Generated question collision detected for topic ${target.topic}; skipping.`
            );
            continue;
          }

          const preparedItem = {
            questionId: `prep-${crypto.randomBytes(6).toString("hex")}`,
            topic: String(aiOutput.topic || target.topic).toUpperCase(),
            difficulty: String(aiOutput.difficulty || target.difficulty).toUpperCase(),
            questionType: aiOutput.questionType || (qInterviewType === "hr" ? "HR" : qInterviewType === "behavioral" ? "BEHAVIORAL" : "TECHNICAL"),
            competency: aiOutput.competency || (qInterviewType === "hr" ? "Culture & Professionalism" : qInterviewType === "behavioral" ? "Behavioral & Leadership" : "Technical Knowledge"),
            question: qText,
            concept: aiOutput.concept || "",
            status: "READY",
            questionHash: qHash,
            createdAt: new Date(),
          };

          // Atomically append to session preparedQuestions
          await InterviewSession.updateOne(
            { _id: session._id },
            { $push: { preparedQuestions: preparedItem } }
          );

          existingTexts.add(qText);
          existingHashes.add(qHash);
          if (aiOutput.concept) existingConcepts.add(aiOutput.concept);
          generatedThisPass++;

          logger.info(
            `[QuestionPlanner] Stored READY question ${preparedItem.questionId} on ${preparedItem.topic} (${preparedItem.difficulty}) in pool.`
          );

          // Save to QuestionBank asynchronously in background for future reusability
          questionBankService
            .saveGeneratedQuestion({
              ...preparedItem,
              role: session.role,
              experienceLevel: session.experienceLevel,
            })
            .catch(() => {});

          // Pre-warm audio in background so candidate gets instant voice narration on claim
          questionAudioService.prewarm(preparedItem.question, {
            interviewId: session.interviewId,
          });
        } catch (genErr) {
          logger.warn(`[QuestionPlanner] Single question generation failed: ${genErr.message}`);
        }
      }
    } finally {
      // Release idempotency lock
      await InterviewSession.updateOne(
        { _id: sessionId, "poolGenerationLock.owner": lockOwner },
        {
          $set: {
            "poolGenerationLock.lockedUntil": null,
            "poolGenerationLock.owner": null,
          },
        }
      ).catch(() => {});
    }
  }

  /**
   * Dispatches replenishment asynchronously without blocking caller thread.
   */
  replenishPoolInBackground(sessionId) {
    if (!sessionId) return;
    setImmediate(() => {
      this.replenishPool(sessionId).catch((err) => {
        logger.warn(`[QuestionPlanner] Background replenishment error for session ${sessionId}: ${err.message}`);
      });
    });
  }

  /**
   * Determines a structured list of target { topic, difficulty } slots to prepare.
   * Walks active topic and upcoming topics in topicOrder respecting caps.
   */
  determineTopicsToBuffer(session, plan, pastTurns) {
    const rawOrder = session.topicOrder?.length ? session.topicOrder : plan?.topics || ["TECHNICAL_FUNDAMENTALS"];
    // Exclude INTRODUCTION from buffer topics
    const topicOrder = rawOrder
      .map((t) => String(t || "").toUpperCase())
      .filter((t) => t && t !== "INTRODUCTION");

    const maxPerTopic = plan?.maxQuestionsPerTopic || 4;
    const MAX_BUFFER_PER_TOPIC = 2; // Never hoard >2 ready questions on a single topic
    const targets = [];

    // Count turns already asked vs ready in buffer per topic
    const askedCountByTopic = {};
    const readyCountByTopic = {};
    topicOrder.forEach((t) => {
      askedCountByTopic[t] = 0;
      readyCountByTopic[t] = 0;
    });

    pastTurns.forEach((turn) => {
      const t = String(turn.topic || "").toUpperCase();
      if (askedCountByTopic[t] !== undefined) askedCountByTopic[t]++;
    });

    (session.preparedQuestions || []).forEach((pq) => {
      const t = String(pq.topic || "").toUpperCase();
      if (pq.status === "READY") {
        if (readyCountByTopic[t] !== undefined) readyCountByTopic[t]++;
      } else if (pq.status === "CLAIMED") {
        if (askedCountByTopic[t] !== undefined) askedCountByTopic[t]++;
      }
    });

    const currentNorm = String(session.currentTopic || "").toUpperCase();
    const activeTopic =
      currentNorm && currentNorm !== "INTRODUCTION" && topicOrder.includes(currentNorm)
        ? currentNorm
        : (topicOrder[0] || "TECHNICAL_FUNDAMENTALS");

    const normSessionDiff = String(session.difficulty || Difficulty.MEDIUM).toUpperCase();
    const baseDiff = normSessionDiff === Difficulty.EASY ? Difficulty.EASY : Difficulty.MEDIUM;
    const upperDiff = Difficulty.HARD;

    // Helper to plan slots for a given topic
    const planSlotsForTopic = (topicName) => {
      const asked = askedCountByTopic[topicName] || 0;
      const ready = readyCountByTopic[topicName] || 0;
      const totalAllocated = asked + ready;

      // How many more questions can this topic receive in total under plan limits?
      const remainingTopicBudget = Math.max(0, maxPerTopic - totalAllocated);
      // How many more questions can be in the ready buffer at once?
      const remainingBufferCap = Math.max(0, MAX_BUFFER_PER_TOPIC - ready);
      const slotsToAdd = Math.min(remainingTopicBudget, remainingBufferCap);

      if (slotsToAdd >= 1 && targets.length < TARGET_READY) {
        targets.push({ topic: topicName, difficulty: baseDiff });
      }
      if (slotsToAdd >= 2 && targets.length < TARGET_READY) {
        targets.push({ topic: topicName, difficulty: upperDiff });
      }
    };

    // 1. First priority: Prepare up to MAX_BUFFER_PER_TOPIC for active topic
    planSlotsForTopic(activeTopic);

    // 2. Next priority: Walk subsequent topics in topicOrder
    for (const t of topicOrder) {
      if (t === activeTopic) continue;
      if (targets.length >= TARGET_READY) break;
      planSlotsForTopic(t);
    }

    // Fallback: If all planned topics are exhausted or no targets generated, buffer active topic
    if (targets.length === 0) {
      targets.push({ topic: activeTopic, difficulty: baseDiff });
      targets.push({ topic: activeTopic, difficulty: upperDiff });
    }

    return targets;
  }
}

export const questionPlannerService = new InterviewQuestionPlannerService();
export default questionPlannerService;
