import { InterviewAction } from "../enums/interview-action.enum.js";
import { InterviewState } from "../enums/interview-state.enum.js";
import { AnswerStatus } from "../enums/answer-status.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { phaseService } from "./phase.service.js";
import logger from "../../config/logger.js";

export class AdaptiveEngineService {
  /**
   * Determines the next authorized interview action based on session state,
   * plan limits, candidate performance, topic coverage, and the last turn analysis.
   *
   * @param {Object} session - Mongoose InterviewSession or plain object
   * @param {Object} plan - Mongoose InterviewPlan or plain object
   * @param {Object} [lastTurn] - Mongoose InterviewTurn or plain object
   * @returns {{ action: string, topic?: string, nextTopic?: string, difficulty?: string, reason: string }}
   */
  determineNextAction(session, plan, lastTurn = null) {
    if (!session) {
      throw new Error("Interview session is required to determine next action.");
    }

    // 1. Terminal / Completed Check
    if (session.interviewState === InterviewState.COMPLETED) {
      return {
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: "Interview session is already marked as completed.",
        decisionAudit: {
          decision: "COMPLETE_INTERVIEW",
          reason: "SESSION_ALREADY_COMPLETED",
          trigger: "SESSION_COMPLETED",
          decisionConfidence: 1.0,
        },
      };
    }

    // 2. Time Expiration Gate
    const timeRemaining = Number(session.timeRemaining ?? 0);
    if (timeRemaining <= 0) {
      logger.info(`Session ${session.interviewId}: Duration expired. Concluding interview.`);
      return {
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: "Interview duration has expired.",
        decisionAudit: {
          decision: "COMPLETE_INTERVIEW",
          reason: "DURATION_EXPIRED",
          trigger: "DURATION_EXPIRED",
          decisionConfidence: 1.0,
        },
      };
    }

    // If less than 60s remaining, candidate doesn't have sufficient time for another meaningful turn
    if (timeRemaining < 60) {
      logger.info(
        `Session ${session.interviewId}: Under 60s remaining (${timeRemaining}s). Concluding interview.`
      );
      return {
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: "Insufficient time remaining to ask another question.",
        decisionAudit: {
          decision: "COMPLETE_INTERVIEW",
          reason: "INSUFFICIENT_TIME_REMAINING",
          trigger: "DURATION_EXPIRED",
          decisionConfidence: 0.98,
        },
      };
    }

    // 3. Global Question Limit Gate
    const globalLimit = plan?.globalQuestionLimit || 10;
    if ((session.questionCount || 0) >= globalLimit) {
      logger.info(
        `Session ${session.interviewId}: Global question limit reached (${session.questionCount}/${globalLimit}). Concluding interview.`
      );
      return {
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: `Global question limit of ${globalLimit} questions reached.`,
        decisionAudit: {
          decision: "COMPLETE_INTERVIEW",
          reason: "GLOBAL_QUESTION_LIMIT_REACHED",
          trigger: "GLOBAL_LIMIT_REACHED",
          decisionConfidence: 1.0,
        },
      };
    }

    // 4. Strict Knowledge Gap Gate
    // STRICT MANDATE: Explicit knowledge gaps NEVER permit a follow-up or defense request.
    const normStatus = lastTurn?.answerStatus || lastTurn?.status;
    const isKnowledgeGap =
      normStatus === AnswerStatus.KNOWLEDGE_GAP ||
      lastTurn?.isExplicitGap === true;

    // 4b. Introduction Turn Transition Gate
    // If the last turn was the introductory question (Turn 1 or topic INTRODUCTION),
    // we never allow follow-up and immediately switch to the first planned topic.
    const isIntro =
      lastTurn?.turnNumber === 1 ||
      (lastTurn?.topic && lastTurn.topic.toUpperCase() === "INTRODUCTION") ||
      (session.currentTopic && session.currentTopic.toUpperCase() === "INTRODUCTION");

    if (isIntro) {
      const candidateTopics = (
        session.topicOrder?.length ? session.topicOrder : session.allowedTopics || []
      ).filter((t) => t && t.toUpperCase() !== "INTRODUCTION");

      const nextTopic =
        candidateTopics[0] ||
        this.getNextTopic(session, plan) ||
        "TECHNICAL_FUNDAMENTALS";

      const nextDifficulty = this.determineBaselineDifficulty(
        plan?.difficulty || session.difficulty
      );

      logger.info(
        `Session ${session.interviewId}: Introduction turn completed. Switching to first planned topic: ${nextTopic} (difficulty: ${nextDifficulty}).`
      );
      return {
        action: InterviewAction.SWITCH_TOPIC,
        nextTopic,
        difficulty: nextDifficulty,
        reason: `Introduction completed; transitioning to first interview topic: ${nextTopic}.`,
        decisionAudit: {
          decision: "SWITCH_TOPIC",
          reason: "INTRODUCTION_COMPLETED",
          trigger: "INTRODUCTION_TRANSITION",
          targetTopic: nextTopic,
          decisionConfidence: 1.0,
        },
      };
    }

    // 5. Depth Established Gate (Knowledge-Depth Early Exit)
    // If the candidate has proven deep understanding or established their depth,
    // we advance to the next topic immediately rather than asking redundant questions.
    const topicCoverage = Array.isArray(session.coverageState)
      ? session.coverageState.find(
          (c) => c.topic?.toUpperCase() === (session.currentTopic || "").toUpperCase()
        )
      : null;

    const isShallow = lastTurn?.depthLevel === "SHALLOW";
    
    const turnScore = lastTurn?.correctnessScore ?? 50;
    const completeness = lastTurn?.completenessScore ?? (isShallow ? 50 : 85);
    const isAccurate = normStatus === AnswerStatus.ACCURATE || turnScore >= 90;

    const isDepthEstablished =
      !isShallow &&
      (Boolean(lastTurn?.depthEstablished) ||
        Boolean(topicCoverage?.depthEstablished) ||
        (normStatus === AnswerStatus.ACCURATE &&
          lastTurn?.depthLevel === "DEEP" &&
          turnScore >= 85));

    if (isDepthEstablished && !isIntro) {
      const nextTopic = this.getNextTopic(session, plan);
      if (nextTopic) {
        logger.info(
          `Session ${session.interviewId}: Knowledge depth established for topic ${session.currentTopic}. Transitioning to ${nextTopic}.`
        );
        return {
          action: InterviewAction.SWITCH_TOPIC,
          nextTopic,
          difficulty: this.determineNextDifficulty(session, plan, lastTurn),
          reason: `Knowledge depth established for ${session.currentTopic}; advancing to next topic ${nextTopic}.`,
          decisionAudit: {
            decision: "SWITCH_TOPIC",
            reason: "DEPTH_ESTABLISHED",
            trigger: "DEPTH_PROVEN_EARLY_EXIT",
            knowledgeLevel: lastTurn?.knowledgeLevel || topicCoverage?.knowledgeLevel || "STRONG",
            depthLevel: lastTurn?.depthLevel || topicCoverage?.depthLevel || "DEEP",
            evidenceLevel: lastTurn?.evidenceLevel || topicCoverage?.evidenceLevel || "MEDIUM",
            experienceAuthenticity: lastTurn?.experienceAuthenticity || topicCoverage?.experienceAuthenticity || "PRODUCTION_VERIFIED",
            targetTopic: nextTopic,
            decisionConfidence: 0.96,
          },
        };
      } else {
        logger.info(
          `Session ${session.interviewId}: Knowledge depth established across all topics. Concluding interview.`
        );
        return {
          action: InterviewAction.COMPLETE_INTERVIEW,
          reason: "Knowledge depth established across all planned interview topics.",
          decisionAudit: {
            decision: "COMPLETE_INTERVIEW",
            reason: "ALL_TOPICS_COVERED",
            trigger: "DEPTH_PROVEN_ALL_TOPICS",
            followUpType: "NONE",
            decisionConfidence: 0.98,
          },
        };
      }
    }

    const hasMisconception =
      Boolean(lastTurn?.contradictionDetected) ||
      (Array.isArray(lastTurn?.misconceptions) && lastTurn.misconceptions.length > 0);
    const hasMissingDetails =
      Array.isArray(lastTurn?.conceptsMissing) && lastTurn.conceptsMissing.length > 0;

    // 5b. Terminal Answer Hard Gate
    // If: correctness >= 90, completeness >= 90, relevance >= 90, depth = DEEP,
    // no misconceptions, no contradictions, no missing important concepts:
    // -> ACCEPT
    // -> NO FOLLOW-UP
    // -> NEXT PRIMARY QUESTION (or next topic if topic question ceiling reached)
    const isTerminalAnswer =
      turnScore >= 90 &&
      completeness >= 90 &&
      (lastTurn?.relevanceScore ?? 90) >= 90 &&
      lastTurn?.depthLevel === "DEEP" &&
      !hasMisconception &&
      (!lastTurn?.conceptsMissing || lastTurn.conceptsMissing.length === 0);

    const maxQuestionsPerTopic = plan?.maxQuestionsPerTopic ?? 3;
    const isTopicCeilingReached = (session.topicQuestionCount || 0) >= maxQuestionsPerTopic;

    if (isTerminalAnswer) {
      logger.info(
        `Session ${session.interviewId}: Terminal answer hard-gate triggered for topic ${session.currentTopic}. No follow-up authorized; advancing.`
      );

      if (isTopicCeilingReached) {
        const nextTopic = this.getNextTopic(session, plan);
        if (nextTopic) {
          return {
            action: InterviewAction.SWITCH_TOPIC,
            nextTopic,
            difficulty: this.determineNextDifficulty(session, plan, lastTurn),
            reason: `Terminal answer accepted and question ceiling reached for ${session.currentTopic}; switching to ${nextTopic}.`,
            decisionAudit: {
              decision: "SWITCH_TOPIC",
              reason: "TOPIC_CEILING_REACHED",
              trigger: "TERMINAL_ANSWER_TOPIC_COMPLETE",
              targetTopic: nextTopic,
              decisionConfidence: 0.96,
            },
          };
        } else {
          return {
            action: InterviewAction.COMPLETE_INTERVIEW,
            reason: "Terminal answer accepted and all topics completed.",
            decisionAudit: {
              decision: "COMPLETE_INTERVIEW",
              reason: "ALL_TOPICS_COVERED",
              trigger: "TERMINAL_ANSWER_ALL_TOPICS_DONE",
              decisionConfidence: 0.98,
            },
          };
        }
      }

      return {
        action: InterviewAction.ASK_QUESTION,
        topic: session.currentTopic,
        difficulty: this.determineNextDifficulty(session, plan, lastTurn),
        reason: `Candidate provided a complete, deep, and accurate terminal answer; accepting answer and advancing to next primary question on ${session.currentTopic}.`,
        decisionAudit: {
          decision: "ASK_QUESTION",
          reason: "TERMINAL_ANSWER_ACCEPTED",
          trigger: "TERMINAL_ANSWER_HARD_GATE",
          followUpType: "NONE",
          targetTopic: session.currentTopic,
          knowledgeLevel: "STRONG",
          depthLevel: "DEEP",
          evidenceLevel: "MEDIUM",
          decisionConfidence: 0.98,
        },
      };
    }

    // 6. Follow-Up Authorization Gate (Knowledge-Driven Probing)
    // - Answer is PARTIAL or shallow ACCURATE (or unproven STRONG / EXCELLENT)
    // - Follow-up must be authorized
    // - Topic follow-up count < maxFollowUpsPerTopic (default 3)
    // - Question follow-up count < maxFollowUpsPerQuestion (respecting plan limit)
    // - Global follow-up count < maxGlobalFollowUps (default 3)
    // - Time remaining > 120s
    // - Consecutive knowledge gaps in topic < 2
    const maxFollowUpsPerQ = plan?.maxFollowUpsPerQuestion ?? 3;
    const maxFollowUpsPerTopic = plan?.maxFollowUpsPerTopic ?? 3;
    const maxGlobalFollowUps = plan?.maxGlobalFollowUps ?? 3;
    const topicFollowUps =
      session.topicFollowUpCount ?? (topicCoverage?.followupsAsked || 0);
    const consecutiveGaps =
      session.candidatePerformance?.consecutiveKnowledgeGapsInTopic || 0;

    // If maxFollowUpsPerQuestion is strictly set to 1, enforce 1 per parent question
    const isAlreadyFollowUp =
      maxFollowUpsPerQ <= 1 &&
      Boolean(lastTurn?.parentTurnId || lastTurn?.isFollowUp);

    const followUpApproved =
      lastTurn?.followUpAllowed !== undefined
        ? Boolean(lastTurn.followUpAllowed)
        : Boolean(lastTurn?.followUp);

    const isFallbackEvaluation = lastTurn?.evaluationSource === "FALLBACK";

    // Rule: IF answer is correct AND complete AND sufficiently detailed (90-100% + complete)
    // -> Do NOT cross-question! Accept answer and move to next primary question/topic.
    const isAccurate90Plus = (normStatus === AnswerStatus.ACCURATE || turnScore >= 90) && turnScore >= 90;
    const isCorrectAndComplete =
      isAccurate90Plus &&
      !isShallow &&
      completeness >= 80 &&
      !hasMisconception &&
      (!lastTurn?.conceptsMissing || lastTurn.conceptsMissing.length === 0) &&
      !lastTurn?.followUpRecommended;

    // Correct but shallow, missing important detail, or explicitly recommended
    const isCorrectButShallowOrMissing =
      (normStatus === AnswerStatus.ACCURATE || turnScore >= 80) &&
      (isShallow || completeness < 75 || hasMissingDetails || Boolean(lastTurn?.followUpRecommended));

    // Determine if candidate qualifies for a cross-question according to recommended tiers:
    // 1. Misconception / contradiction -> targeted probe
    // 2. Correct AND complete (90-100% + complete) -> Do NOT cross-question!
    // 3. Correct but shallow / missing important detail -> cross-question to test practical/deeper understanding
    // 4. 80-90% -> Ask 1 meaningful cross-question to validate depth
    // 5. 60-80% -> Ask follow-up/cross-question
    // 6. <40% -> Usually no; don't waste multiple cross-questions; only 1 clarification if useful
    // 7. 40-60% -> Clarify fundamentals, then reassess
    let isQualityCandidateForFollowUp = false;

    if (isFallbackEvaluation) {
      // Conservative handling: never make aggressive follow-up decisions on uncertain fallback
      isQualityCandidateForFollowUp = false;
    } else if (hasMisconception) {
      isQualityCandidateForFollowUp = true;
    } else if (isTerminalAnswer || isCorrectAndComplete) {
      // 90-100% + complete: ❌ No cross-question!
      isQualityCandidateForFollowUp = false;
    } else if (isCorrectButShallowOrMissing) {
      isQualityCandidateForFollowUp = true;
    } else if (turnScore >= 80 && turnScore < 90) {
      // 80-90%: ✅ Yes -> Ask 1 meaningful cross-question to validate depth
      isQualityCandidateForFollowUp = true;
    } else if (normStatus === AnswerStatus.PARTIAL || (turnScore >= 60 && turnScore < 80)) {
      // 60-80%: ✅ Yes -> Ask follow-up/cross-question
      isQualityCandidateForFollowUp = true;
    } else if (turnScore < 40 || normStatus === AnswerStatus.INCORRECT) {
      // <40%: ❌ Usually no -> Don't waste multiple cross-questions; move to another question
      const alreadyProbed = (session.followUpCount || 0) >= 1 || Boolean(lastTurn?.isFollowUp);
      isQualityCandidateForFollowUp = !alreadyProbed && Boolean(lastTurn?.followUpRecommended);
    } else if ((turnScore >= 40 && turnScore < 60) || lastTurn?.knowledgeLevel === "BASIC") {
      // 40-60%: ✅ Yes -> Clarify fundamentals, then reassess
      isQualityCandidateForFollowUp = true;
    }

    // 80-90% rule: Ask at most 1 meaningful cross-question to validate depth
    const isEightyToNinety = turnScore >= 80 && turnScore < 90 && !isShallow;
    if (isEightyToNinety && (session.followUpCount || 0) >= 1) {
      isQualityCandidateForFollowUp = false;
    }

    const canFollowUp =
      !isAlreadyFollowUp &&
      !isKnowledgeGap &&
      !isDepthEstablished &&
      !isTerminalAnswer &&
      !isFallbackEvaluation &&
      (lastTurn?.followUpAllowed === true || isQualityCandidateForFollowUp) &&
      followUpApproved &&
      (session.followUpCount || 0) < maxFollowUpsPerQ &&
      topicFollowUps < maxFollowUpsPerTopic &&
      (session.globalFollowUpCount || 0) < maxGlobalFollowUps &&
      timeRemaining > 120 &&
      consecutiveGaps < 2;

    if (canFollowUp) {
      logger.info(
        `Session ${session.interviewId}: Follow-up authorized for turn ${session.questionCount} on topic ${session.currentTopic}.`
      );

      // Determine follow-up difficulty and type based on candidate's knowledge estimate & misconceptions
      let followUpDifficulty = lastTurn?.difficulty || Difficulty.EASY;
      let followUpType = lastTurn?.followUpType || "DEPTH_PROBE";
      let reason = "Candidate demonstrated partial understanding; probing missing concepts with follow-up.";
      let trigger = "DEPTH_NOT_ESTABLISHED";
      let decisionConfidence = 0.85;

      if (hasMisconception) {
        followUpType = "DEPTH_PROBE";
        followUpDifficulty = Difficulty.MEDIUM;
        trigger = "MISCONCEPTION_FLAGGED";
        reason = "Candidate demonstrated a contradiction or misconception; asking targeted probe.";
        decisionConfidence = 0.93;
      } else if (lastTurn?.followUpType === "SCENARIO") {
        followUpType = "SCENARIO";
        followUpDifficulty = lastTurn?.difficulty || Difficulty.MEDIUM;
        trigger = "SCENARIO_PROBE";
        reason = "Probing real-world application with a practical technical scenario.";
        decisionConfidence = 0.88;
      } else if (lastTurn?.knowledgeLevel === "BASIC" || turnScore <= 50) {
        followUpType = "CLARIFICATION";
        followUpDifficulty = Difficulty.EASY;
        trigger = "WEAK_BASIC_ANSWER";
        reason = "Candidate demonstrated basic understanding; clarifying fundamentals then reassessing.";
        decisionConfidence = 0.82;
      } else if (lastTurn?.knowledgeLevel === "INTERMEDIATE" || turnScore <= 75) {
        followUpType = "DEPTH_PROBE";
        followUpDifficulty = Difficulty.MEDIUM;
        trigger = "INTERMEDIATE_DEPTH_PROBE";
        reason = "Candidate demonstrated intermediate grasp; probing deeper implementation details.";
        decisionConfidence = 0.86;
      } else if (lastTurn?.followUpType === "VALIDATION") {
        followUpType = "VALIDATION";
        followUpDifficulty = Difficulty.HARD;
        trigger = "SHALLOW_HIGH_SCORE";
        reason = "Validating practical hands-on depth with validation follow-up.";
        decisionConfidence = 0.89;
      } else if (lastTurn?.knowledgeLevel === "STRONG" || turnScore <= 90) {
        followUpType = "PRACTICAL";
        followUpDifficulty = Difficulty.HARD;
        trigger = "STRONG_PRACTICAL_PROBE";
        reason = "Candidate demonstrated strong understanding (80-90%); asking 1 meaningful cross-question to validate depth.";
        decisionConfidence = 0.88;
      } else {
        followUpType = "VALIDATION";
        followUpDifficulty = Difficulty.HARD;
        trigger = "SHALLOW_HIGH_SCORE";
        reason = "Validating practical hands-on depth with validation follow-up.";
        decisionConfidence = 0.89;
      }

      // If the answer was partial without specific missing concepts, confidence is lower
      if (normStatus === AnswerStatus.PARTIAL && (!lastTurn?.conceptsMissing || lastTurn.conceptsMissing.length === 0)) {
        decisionConfidence = 0.65;
      }

      // Explicit internal follow-up reason enum
      let internalFollowUpReason = "PRACTICAL_DEPTH";
      const missingConcept =
        lastTurn?.missingConcept ||
        (Array.isArray(lastTurn?.conceptsMissing) && lastTurn.conceptsMissing[0]) ||
        null;

      if (Boolean(lastTurn?.contradictionDetected)) {
        internalFollowUpReason = "CONTRADICTION";
      } else if (hasMisconception) {
        internalFollowUpReason = "MISCONCEPTION";
      } else if (turnScore < 60 || lastTurn?.knowledgeLevel === "BASIC") {
        internalFollowUpReason = "CLARIFICATION";
      } else if (hasMissingDetails) {
        internalFollowUpReason = "MISSING_CONCEPT";
      } else if (isShallow) {
        internalFollowUpReason = "SHALLOW_ANSWER";
      } else if (turnScore >= 80 && turnScore <= 90) {
        internalFollowUpReason = "PRACTICAL_DEPTH";
      } else {
        internalFollowUpReason = "PRACTICAL_DEPTH";
      }

      const targetConcept =
        (lastTurn?.misconceptions?.length ? lastTurn.misconceptions[0] : null) ||
        missingConcept ||
        lastTurn?.concept ||
        session.currentTopic;

      const decisionAudit = {
        decision: "FOLLOW_UP",
        reason: internalFollowUpReason,
        followUpReason: internalFollowUpReason,
        missingConcept,
        trigger,
        knowledgeLevel: lastTurn?.knowledgeLevel || "INTERMEDIATE",
        depthLevel: lastTurn?.depthLevel || "SHALLOW",
        evidenceLevel: lastTurn?.evidenceLevel || topicCoverage?.evidenceLevel || "LOW",
        experienceAuthenticity: lastTurn?.experienceAuthenticity || "UNPROVEN",
        targetConcept,
        followUpType,
        decisionConfidence,
      };

      return {
        action: InterviewAction.FOLLOW_UP,
        topic: session.currentTopic,
        difficulty: followUpDifficulty,
        followUpType,
        followUpReason: internalFollowUpReason,
        missingConcept,
        reason,
        decisionAudit,
      };
    }

    // 7. Phase Gate
    // If the current phase has used its question budget (or covered all
    // its topics), advance to the next phase even when the current topic's
    // own per-topic budget isn't met.
    if (phaseService.hasPlan(session) && phaseService.isPhaseExhausted(session)) {
      const nextTopic =
        phaseService.nextPhaseFirstTopic(session) || this.getNextTopic(session, plan);
      if (nextTopic && nextTopic.toUpperCase() !== (session.currentTopic || "").toUpperCase()) {
        return {
          action: InterviewAction.SWITCH_TOPIC,
          nextTopic,
          difficulty: this.determineNextDifficulty(session, plan, lastTurn),
          reason: `Phase budget met; advancing to the ${phaseService.phaseOfTopic(
            session,
            nextTopic
          )} phase (topic ${nextTopic}).`,
          decisionAudit: {
            decision: "SWITCH_TOPIC",
            reason: "PHASE_BUDGET_MET",
            trigger: "PHASE_EXHAUSTED",
            targetTopic: nextTopic,
            decisionConfidence: 0.95,
          },
        };
      }
    }

    // 8. Topic Switch Gates
    // Reason A: Consecutive knowledge gaps in topic (candidate has gap in this area, switch to avoid frustration)
    if (consecutiveGaps >= 2) {
      const nextTopic = this.getNextTopic(session, plan);
      if (nextTopic) {
        logger.info(
          `Session ${session.interviewId}: 2 consecutive knowledge gaps on topic ${session.currentTopic}. Switching to next topic: ${nextTopic}.`
        );
        return {
          action: InterviewAction.SWITCH_TOPIC,
          nextTopic,
          difficulty: this.determineNextDifficulty(session, plan, lastTurn),
          reason: `Repeated knowledge gaps in ${session.currentTopic}; switching to ${nextTopic} to assess candidate in other areas.`,
          decisionAudit: {
            decision: "SWITCH_TOPIC",
            reason: "CONSECUTIVE_KNOWLEDGE_GAPS",
            trigger: "CONSECUTIVE_GAPS_EXIT",
            targetTopic: nextTopic,
            decisionConfidence: 0.97,
          },
        };
      } else {
        // No remaining topics available
        logger.info(
          `Session ${session.interviewId}: Repeated knowledge gaps and no further topics available. Concluding interview.`
        );
        return {
          action: InterviewAction.COMPLETE_INTERVIEW,
          reason: "All planned interview topics have been assessed.",
          decisionAudit: {
            decision: "COMPLETE_INTERVIEW",
            reason: "ALL_TOPICS_COVERED",
            trigger: "CONSECUTIVE_GAPS_EXIT_ALL_DONE",
            decisionConfidence: 0.98,
          },
        };
      }
    }

    // Reason B: Topic Question Budget Ceiling Met
    const targetQuestionsForTopic = this.getTargetQuestionsForTopic(
      session.currentTopic,
      plan
    );
    const topicCount = session.topicQuestionCount || 0;

    if (topicCount >= targetQuestionsForTopic || topicFollowUps >= maxFollowUpsPerTopic) {
      const nextTopic = this.getNextTopic(session, plan);
      if (nextTopic) {
        logger.info(
          `Session ${session.interviewId}: Topic ceiling reached for ${session.currentTopic} (${topicCount}/${targetQuestionsForTopic}). Switching to ${nextTopic}.`
        );
        return {
          action: InterviewAction.SWITCH_TOPIC,
          nextTopic,
          difficulty: this.determineNextDifficulty(session, plan, lastTurn),
          reason: `Target question ceiling reached for topic ${session.currentTopic}; advancing to ${nextTopic}.`,
          decisionAudit: {
            decision: "SWITCH_TOPIC",
            reason: "TOPIC_CEILING_REACHED",
            trigger: "TOPIC_CEILING_MET",
            targetTopic: nextTopic,
            decisionConfidence: 0.95,
          },
        };
      } else {
        // All planned topics have completed their budget
        logger.info(
          `Session ${session.interviewId}: All planned topics completed. Concluding interview.`
        );
        return {
          action: InterviewAction.COMPLETE_INTERVIEW,
          reason: "All planned interview topics have been thoroughly covered.",
          decisionAudit: {
            decision: "COMPLETE_INTERVIEW",
            reason: "ALL_TOPICS_COVERED",
            trigger: "TOPIC_CEILING_ALL_DONE",
            decisionConfidence: 0.98,
          },
        };
      }
    }

    // 9. Normal Next Question within current topic (ASK_QUESTION)
    const nextDifficulty = this.determineNextDifficulty(session, plan, lastTurn);

    if (isKnowledgeGap) {
      const targetConcept =
        lastTurn?.concept ||
        (Array.isArray(lastTurn?.conceptsMissing) && lastTurn.conceptsMissing[0]) ||
        session.currentTopic;

      return {
        action: InterviewAction.ASK_QUESTION,
        topic: session.currentTopic,
        difficulty: nextDifficulty,
        reason: `Explicit knowledge gap acknowledged; pivoting to alternative concept on ${session.currentTopic}.`,
        decisionAudit: {
          decision: "ASK_QUESTION",
          reason: "KNOWLEDGE_GAP",
          trigger: "GAP_EXPLORE_ALTERNATIVE_CONCEPT",
          followUpType: "NONE",
          targetConcept,
          targetTopic: session.currentTopic,
          knowledgeLevel: topicCoverage?.knowledgeLevel || "NONE",
          depthLevel: topicCoverage?.depthLevel || "SHALLOW",
          evidenceLevel: topicCoverage?.evidenceLevel || "LOW",
          decisionConfidence: 0.99,
        },
      };
    }

    const isAnswerComplete =
      isAccurate &&
      !isShallow &&
      turnScore >= 90 &&
      completeness >= 80 &&
      !lastTurn?.followUpRecommended &&
      !hasMisconception;

    return {
      action: InterviewAction.ASK_QUESTION,
      topic: session.currentTopic,
      difficulty: nextDifficulty,
      reason: isAnswerComplete
        ? `Candidate answer was accurate and complete; accepting answer and moving to next primary question on ${session.currentTopic}.`
        : `Continuing current topic ${session.currentTopic} at ${nextDifficulty} difficulty.`,
      decisionAudit: {
        decision: "ASK_QUESTION",
        reason: isAnswerComplete ? "COMPLETE_ANSWER_ACCEPTED" : "TOPIC_QUESTION_PROGRESSION",
        trigger: isAnswerComplete ? "COMPLETE_ANSWER_NO_FOLLOWUP" : "NORMAL_QUESTION_PROGRESSION",
        followUpType: "NONE",
        targetTopic: session.currentTopic,
        knowledgeLevel: topicCoverage?.knowledgeLevel || (isAnswerComplete ? "STRONG" : "NONE"),
        depthLevel: topicCoverage?.depthLevel || (isAnswerComplete ? "ADEQUATE" : "SHALLOW"),
        evidenceLevel: topicCoverage?.evidenceLevel || (isAnswerComplete ? "MEDIUM" : "LOW"),
        decisionConfidence: isAnswerComplete ? 0.95 : 0.85,
      },
    };
  }

  /**
   * Helper to retrieve target question budget for a specific topic.
   */
  getTargetQuestionsForTopic(topic, plan) {
    if (!topic || !plan) return plan?.maxQuestionsPerTopic || 3;

    if (Array.isArray(plan.topicBudgets) && plan.topicBudgets.length > 0) {
      const budgetItem = plan.topicBudgets.find(
        (b) => b.topic?.toUpperCase() === topic.toUpperCase()
      );
      if (budgetItem && typeof budgetItem.targetQuestions === "number") {
        return budgetItem.targetQuestions;
      }
    }

    return plan.maxQuestionsPerTopic || 3;
  }

  /**
   * Selects the next uncompleted topic from the session's topic order.
   *
   * @param {Object} session - InterviewSession
   * @param {Object} plan - InterviewPlan
   * @returns {string|null} Next topic string, or null if all topics are exhausted
   */
  getNextTopic(session, plan) {
    let topicOrder =
      (Array.isArray(session.topicOrder) && session.topicOrder.length > 0
        ? session.topicOrder
        : session.allowedTopics) || [];

    // Exclude INTRODUCTION from ever being chosen as a subsequent interview topic
    topicOrder = topicOrder.filter((t) => t && t.toUpperCase() !== "INTRODUCTION");

    if (topicOrder.length === 0) return null;

    // Phase layer: once the current phase is done, restrict selection to
    // topics from later phases so we don't linger on this phase's
    // still-unasked topics (or revisit earlier phases).
    if (phaseService.hasPlan(session) && phaseService.isPhaseExhausted(session)) {
      const later = phaseService.laterPhaseTopics(session);
      if (later.length > 0) topicOrder = later;
    }

    const currentTopicUpper = (session.currentTopic || "").toUpperCase();
    const currentIndex = topicOrder.findIndex(
      (t) => t.toUpperCase() === currentTopicUpper
    );

    // Look for the next topic in topicOrder after the current topic
    for (let i = currentIndex + 1; i < topicOrder.length; i++) {
      const candidateTopic = topicOrder[i];
      // Verify topic hasn't already been exhausted
      const coverageItem = Array.isArray(session.coverageState)
        ? session.coverageState.find(
            (c) => c.topic?.toUpperCase() === candidateTopic.toUpperCase()
          )
        : null;

      const targetQ = this.getTargetQuestionsForTopic(candidateTopic, plan);
      if (!coverageItem || (coverageItem.questionsAsked || 0) < targetQ) {
        return candidateTopic;
      }
    }

    // If current was the last in order, or subsequent topics are exhausted, check any unvisited topic
    for (const candidateTopic of topicOrder) {
      if (candidateTopic.toUpperCase() === currentTopicUpper) continue;
      const coverageItem = Array.isArray(session.coverageState)
        ? session.coverageState.find(
            (c) => c.topic?.toUpperCase() === candidateTopic.toUpperCase()
          )
        : null;

      const targetQ = this.getTargetQuestionsForTopic(candidateTopic, plan);
      if (!coverageItem || (coverageItem.questionsAsked || 0) < targetQ) {
        return candidateTopic;
      }
    }

    return null;
  }

  /**
   * Dynamically adapts question difficulty based on candidate performance streaks and plan bounds.
   * Strict Rule: Never jump from EASY directly to HARD.
   *
   * @param {Object} session - InterviewSession
   * @param {Object} plan - InterviewPlan
   * @param {Object} [lastTurn] - Last analyzed InterviewTurn
   * @returns {string} Calculated difficulty ("EASY", "MEDIUM", "HARD")
   */
  determineNextDifficulty(session, plan, lastTurn = null) {
    const planDifficulty = (plan?.difficulty || session.difficulty || Difficulty.ADAPTIVE).toUpperCase();

    // If the plan has a fixed difficulty, maintain the user's configured level
    if (planDifficulty !== Difficulty.ADAPTIVE) {
      return planDifficulty;
    }

    // For ADAPTIVE plans:
    const currentDiff = (lastTurn?.difficulty || Difficulty.EASY).toUpperCase();
    const streakCorrect = session.candidatePerformance?.streakCorrect || 0;
    const answerStatus = lastTurn?.answerStatus;
    const knowledgeLevel = lastTurn?.knowledgeLevel;

    // 1. Strong Performance: Candidate answers accurately or demonstrates STRONG/DEEP knowledge
    if (
      answerStatus === AnswerStatus.ACCURATE ||
      knowledgeLevel === "STRONG" ||
      knowledgeLevel === "DEEP"
    ) {
      // Step up difficulty after sustained correct answers (streak >= 2) or proven strong knowledge
      if (streakCorrect >= 2 || knowledgeLevel === "STRONG" || knowledgeLevel === "DEEP") {
        if (currentDiff === Difficulty.EASY) return Difficulty.MEDIUM;
        if (currentDiff === Difficulty.MEDIUM) return Difficulty.HARD;
        return Difficulty.HARD;
      }
      // Single correct answer maintains current difficulty to establish stability
      return currentDiff;
    }

    // 2. Struggling Performance: Knowledge gap, incorrect answer, or NONE knowledge level
    if (
      answerStatus === AnswerStatus.KNOWLEDGE_GAP ||
      answerStatus === AnswerStatus.INCORRECT ||
      knowledgeLevel === "NONE"
    ) {
      // Step down difficulty
      if (currentDiff === Difficulty.HARD) return Difficulty.MEDIUM;
      if (currentDiff === Difficulty.MEDIUM) return Difficulty.EASY;
      return Difficulty.EASY;
    }

    // 3. Partial Performance / Intermediate: Maintain current difficulty
    if (answerStatus === AnswerStatus.PARTIAL || knowledgeLevel === "INTERMEDIATE") {
      return currentDiff;
    }

    // Default fallback
    return currentDiff || Difficulty.EASY;
  }

  /**
   * Baseline difficulty for topic initialization.
   */
  determineBaselineDifficulty(planDifficulty) {
    const norm = (planDifficulty || Difficulty.ADAPTIVE).toUpperCase();
    if (norm === Difficulty.ADAPTIVE) return Difficulty.EASY;
    return norm;
  }
}

export const adaptiveEngineService = new AdaptiveEngineService();
export default adaptiveEngineService;
