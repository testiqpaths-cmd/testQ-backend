import crypto from "crypto";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import logger from "../../config/logger.js";

/**
 * FollowUpProbePlannerService
 *
 * Sprint 6 In-Flight Follow-Up Probe Prefetching.
 * Precomputes targeted follow-up probe candidates for the active question
 * while the candidate is formulating and submitting their answer.
 *
 * Preserves semantic alignment:
 * The candidate's actual answer remains authoritative. If the adaptive engine
 * decides FOLLOW_UP with a specific reason (MISSING_CONCEPT, SHALLOW_ANSWER, etc.),
 * a matching prefetched probe is served in <100ms, eliminating the 2.6s synchronous LLM/embedding delay.
 */
export class FollowUpProbePlannerService {
  /**
   * Generates domain-aware targeted probe candidates for a question.
   *
   * @param {Object} currentQuestion - The active question served to the candidate
   * @param {string} [role="Software Engineer"]
   * @returns {Array<Object>} List of candidate probes
   */
  synthesizeProbes(currentQuestion, role = "Software Engineer") {
    const topic = (currentQuestion.topic || "GENERAL").toUpperCase();
    const qText = (currentQuestion.questionText || currentQuestion.question || "").toLowerCase();
    const diff = currentQuestion.difficulty || Difficulty.MEDIUM;
    const parentQId = currentQuestion.id || currentQuestion.questionId || "q-active";

    const probes = [];

    // Domain Probe Generator: Node.js
    if (topic.includes("NODE")) {
      if (qText.includes("event loop") || qText.includes("libuv")) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "process.nextTick vs Promise microtasks",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "Between event loop phases, how does libuv prioritize microtasks between process.nextTick and Promise fulfillment callbacks?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "CPU starvation in poll phase",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "If a CPU-bound operation blocks the main thread during execution, what happens to incoming I/O events in the poll phase and timer callbacks?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "setImmediate vs setTimeout(0)",
          probeType: "VALIDATION",
          probeReason: "SHALLOW_ANSWER",
          question:
            "Can you clarify the exact execution order difference between setImmediate() and setTimeout(fn, 0) when scheduled within an I/O callback?",
        });
      } else if (qText.includes("stream") || qText.includes("backpressure")) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "highWaterMark and drain event",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "How does Writable.write() utilize highWaterMark to signal backpressure, and what triggers the readable stream to resume piping?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Unbounded buffer OOM crash",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "What concrete failure mode occurs in production Node.js services if backpressure is ignored when proxying streaming HTTP responses?",
        });
      } else if (qText.includes("worker") || qText.includes("cluster") || qText.includes("memory")) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "SharedArrayBuffer and Atomics",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "When worker threads communicate using SharedArrayBuffer, how do you prevent race conditions without thread-locking the event loop?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "V8 Heap snapshot retention trees",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "In production, how do you capture and interpret a V8 heap snapshot to find the retaining path of a memory leak without taking down the process?",
        });
      }
    }

    // Domain Probe Generator: PostgreSQL
    if (topic.includes("POSTGRES")) {
      if (qText.includes("mvcc") || qText.includes("concurrency") || qText.includes("isolation")) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Vacuum and transaction ID wraparound",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "Because MVCC creates new row versions on update, how does PostgreSQL autovacuum prevent dead tuple bloat and 32-bit transaction ID wraparound?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Serialization failure (40001) retry loops",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "Under Serializable isolation level, what application-level pattern is required to handle serialization anomalies (SQLSTATE 40001)?",
        });
      } else if (
        qText.includes("index") ||
        qText.includes("explain") ||
        qText.includes("query") ||
        qText.includes("tuning") ||
        qText.includes("slow")
      ) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Composite leftmost prefix rule & write amplification",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "How does the leftmost column rule affect multi-column B-tree index usability, and what write amplification overhead does every index impose on INSERTs?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "EXPLAIN ANALYZE buffer hit ratios",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "When inspecting an EXPLAIN (ANALYZE, BUFFERS) plan, how do you distinguish between memory buffer hits and physical disk reads to identify missing indexes?",
        });
      }
    }

    // Domain Probe Generator: Redis
    if (topic.includes("REDIS")) {
      if (qText.includes("persistence") || qText.includes("rdb") || qText.includes("aof")) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "AOF fsync policies trade-offs",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "How do the three Redis AOF fsync policies ('always', 'everysec', 'no') trade off write IOPS against worst-case data loss during a power outage?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "fork copy-on-write memory overhead",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "During background RDB snapshotting or AOF rewrite via fork(), what causes Redis memory usage to spike under write-heavy workloads?",
        });
      } else if (
        qText.includes("lock") ||
        qText.includes("cache") ||
        qText.includes("thread") ||
        qText.includes("single")
      ) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Redlock multi-node drift & failover safety",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "In a multi-node Redis cluster with asynchronous replication, what edge case breaks single-instance SET NX EX distributed locks, and how does Redlock address this?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Cache stampede mitigation & probabilistic early expiration",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "When high-throughput read traffic experiences cache stampede upon key expiration, what strategy (such as probabilistic early expiration or mutex locks) prevents database overload?",
        });
      } else if (qText.includes("sorted set") || qText.includes("cluster") || qText.includes("eviction") || qText.includes("rate")) {
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Skip list and Hash table implementation",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
          question:
            "Why does Redis implement sorted sets using both a skip list and a hash table, and what is the time complexity of ZADD and ZRANGEBYSCORE?",
        });
        probes.push({
          probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
          parentQuestionId: parentQId,
          topic,
          difficulty: diff,
          targetConcept: "Sliding window rate limiter with ZREMRANGEBYSCORE",
          probeType: "PRACTICAL",
          probeReason: "PRACTICAL_DEPTH",
          question:
            "How would you implement an atomic sliding-window rate limiter in Redis using a sorted set and MULTI/EXEC or Lua scripts?",
        });
      }
    }

    // Generic high-caliber technical probes if no exact keyword match
    if (probes.length === 0) {
      probes.push({
        probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
        parentQuestionId: parentQId,
        topic,
        difficulty: diff,
        targetConcept: `${topic} internal mechanics`,
        probeType: "DEPTH_PROBE",
        probeReason: "MISSING_CONCEPT",
        question: `Could you dive deeper into the internal mechanism and data structures that power this in ${topic}?`,
      });
      probes.push({
        probeId: `probe-${crypto.randomBytes(4).toString("hex")}`,
        parentQuestionId: parentQId,
        topic,
        difficulty: diff,
        targetConcept: `${topic} production edge case`,
        probeType: "PRACTICAL",
        probeReason: "PRACTICAL_DEPTH",
        question: `In a high-throughput production environment, what failure mode or bottleneck have you encountered with this in ${topic}?`,
      });
    }

    return probes.map((p) => ({
      ...p,
      status: "READY",
      createdAt: new Date(),
    }));
  }

  /**
   * Prepares and stores probe candidates for the current question in background.
   *
   * @param {Object} session - Mongoose session or interviewId
   * @param {Object} currentQuestion - The question currently shown to the candidate
   */
  async prepareProbesForQuestion(session, currentQuestion) {
    if (!session || !currentQuestion) return;
    const parentQId = currentQuestion.id || currentQuestion.questionId;
    if (!parentQId || (currentQuestion.topic || "").toUpperCase() === "INTRODUCTION") return;

    try {
      const probes = this.synthesizeProbes(currentQuestion, session.role);

      await InterviewSession.updateOne(
        { _id: session._id || session.id },
        {
          $push: {
            prefetchedProbes: { $each: probes },
          },
        }
      );

      logger.info(
        `[ProbePlanner] Prepared ${probes.length} follow-up probe candidates for question ${parentQId} on ${currentQuestion.topic}`
      );
    } catch (err) {
      logger.warn(`[ProbePlanner] Failed to prepare probes (non-fatal): ${err.message}`);
    }
  }

  /**
   * Evaluates available prefetched probes against actual answer analysis and adaptive decision.
   * If a probe matches reason and concept and was NOT already covered by candidate, claims it.
   *
   * @param {Object} session - Mongoose session
   * @param {string} parentQuestionId - Active question ID
   * @param {Object} decision - Adaptive engine decision object
   * @param {Object} analysisResult - Result from answer analysis
   * @returns {Promise<Object|null>} Claimed probe turn payload or null for dynamic fallback
   */
  async claimMatchingProbe(session, parentQuestionId, decision, analysisResult = {}) {
    if (!session || !decision || !parentQuestionId) return null;

    try {
      const sessionDoc = await InterviewSession.findById(session._id).select("prefetchedProbes").lean();
      if (!sessionDoc || !Array.isArray(sessionDoc.prefetchedProbes)) return null;

      const readyProbes = sessionDoc.prefetchedProbes.filter(
        (p) => p.parentQuestionId === String(parentQuestionId) && p.status === "READY"
      );

      if (!readyProbes.length) return null;

      const demonstrated = Array.isArray(analysisResult.conceptsDemonstrated)
        ? analysisResult.conceptsDemonstrated.map((c) => String(c).toLowerCase())
        : [];

      // Misconceptions & contradictions must be dynamically generated to target the candidate's exact words
      if (
        decision.followUpReason === "MISCONCEPTION" ||
        decision.followUpReason === "CONTRADICTION" ||
        decision.decisionAudit?.trigger === "MISCONCEPTION_FLAGGED" ||
        Boolean(analysisResult?.contradictionDetected)
      ) {
        logger.info(
          `[ProbePlanner] Follow-up involves misconception/contradiction (${decision.followUpReason || "CONTRADICTION"}). Rejecting prefetched probes to preserve authentic dynamic probe generation.`
        );
        return null;
      }

      // 1. Prioritize probes whose target concept was MISSING or whose reason matches
      let matchedProbe = null;

      // 1a. Match by exact probe reason, follow-up type, or missing concept
      for (const probe of readyProbes) {
        const targetLower = (probe.targetConcept || "").toLowerCase();
        // Candidate did NOT already demonstrate this concept
        const alreadyDemonstrated = demonstrated.some((d) => d.includes(targetLower) || targetLower.includes(d));
        if (alreadyDemonstrated) continue;

        const reasonMatches = probe.probeReason === decision.followUpReason;
        const typeMatches = probe.probeType === decision.followUpType;
        const conceptMatches = decision.missingConcept && targetLower.includes(String(decision.missingConcept).toLowerCase());

        if (reasonMatches || typeMatches || conceptMatches) {
          matchedProbe = probe;
          break;
        }
      }

      // If no probe matched the specific reason/concept, fall back to dynamic generation
      if (!matchedProbe) {
        logger.info(
          `[ProbePlanner] No prefetched probe matched reason '${decision.followUpReason}' or type '${decision.followUpType}'. Falling back to dynamic generation.`
        );
        return null;
      }

      // Atomically mark probe as USED in session document
      const updateResult = await InterviewSession.updateOne(
        {
          _id: session._id,
          "prefetchedProbes.probeId": matchedProbe.probeId,
          "prefetchedProbes.status": "READY",
        },
        {
          $set: {
            "prefetchedProbes.$.status": "USED",
            "prefetchedProbes.$.usedAt": new Date(),
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        // Concurrently claimed by another worker
        return null;
      }

      logger.info(
        `[ProbePlanner] Successfully CLAIMED prefetched probe ${matchedProbe.probeId} for reason ${decision.followUpReason} (concept: ${matchedProbe.targetConcept})`
      );

      return {
        probeId: matchedProbe.probeId,
        questionText: matchedProbe.question,
        topic: matchedProbe.topic,
        concept: matchedProbe.targetConcept,
        difficulty: matchedProbe.difficulty || decision.difficulty || Difficulty.MEDIUM,
        questionType: matchedProbe.probeType || "DEPTH_PROBE",
        competency: "Technical Knowledge",
        questionSource: "prefetched_probe",
      };
    } catch (err) {
      logger.warn(`[ProbePlanner] Error claiming matching probe (non-fatal): ${err.message}`);
      return null;
    }
  }

  /**
   * Discards remaining READY probes for a question that is no longer active.
   *
   * @param {string|Object} sessionId
   * @param {string} parentQuestionId
   */
  async discardProbesForQuestion(sessionId, parentQuestionId) {
    if (!sessionId || !parentQuestionId) return;
    try {
      await InterviewSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            "prefetchedProbes.$[elem].status": "DISCARDED",
          },
        },
        {
          arrayFilters: [
            { "elem.parentQuestionId": String(parentQuestionId), "elem.status": "READY" },
          ],
        }
      );
    } catch {
      // Non-fatal
    }
  }
}

export const followUpProbePlannerService = new FollowUpProbePlannerService();
export default followUpProbePlannerService;
