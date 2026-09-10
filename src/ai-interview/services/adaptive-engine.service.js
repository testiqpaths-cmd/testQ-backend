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
      };
    }

    // 2. Time Expiration Gate
    const timeRemaining = Number(session.timeRemaining ?? 0);
    if (timeRemaining <= 0) {
      logger.info(`Session ${session.interviewId}: Duration expired. Concluding interview.`);
      return {
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: "Interview duration has expired.",
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
      };
    }

    // 4. Strict Knowledge Gap Gate
    // STRICT MANDATE: Explicit knowledge gaps NEVER permit a follow-up or defense request.
    const isKnowledgeGap = lastTurn?.answerStatus === AnswerStatus.KNOWLEDGE_GAP;

    // 5. Follow-Up Authorization Gate
    // Rules for FOLLOW_UP:
    // - Answer must be PARTIAL (not ACCURATE, not KNOWLEDGE_GAP, not INCORRECT)
    // - Follow-up must be authorized (turn.followUp === true)
    // - Follow-up count on current question < maxFollowUpsPerQuestion (strict 1)
    // - Global follow-up count < maxGlobalFollowUps (default 3)
    // - Time remaining > 120s
    // - Consecutive knowledge gaps in topic < 2
    const maxFollowUpsPerQ = plan?.maxFollowUpsPerQuestion ?? 1;
    const maxGlobalFollowUps = plan?.maxGlobalFollowUps ?? 3;
    const consecutiveGaps =
      session.candidatePerformance?.consecutiveKnowledgeGapsInTopic || 0;
    const isAlreadyFollowUp = Boolean(
      lastTurn?.parentTurnId || lastTurn?.isFollowUp
    );

    const followUpApproved =
      lastTurn?.followUpAllowed !== undefined
        ? Boolean(lastTurn.followUpAllowed)
        : Boolean(lastTurn?.followUp);

    const canFollowUp =
      !isAlreadyFollowUp &&
      !isKnowledgeGap &&
      lastTurn?.answerStatus === AnswerStatus.PARTIAL &&
      followUpApproved &&
      (session.followUpCount || 0) < maxFollowUpsPerQ &&
      (session.globalFollowUpCount || 0) < maxGlobalFollowUps &&
      timeRemaining > 120 &&
      consecutiveGaps < 2;

    if (canFollowUp) {
      logger.info(
        `Session ${session.interviewId}: Follow-up authorized for turn ${session.questionCount} on topic ${session.currentTopic}.`
      );
      return {
        action: InterviewAction.FOLLOW_UP,
        topic: session.currentTopic,
        difficulty: lastTurn?.difficulty || Difficulty.EASY,
        reason: "Candidate demonstrated partial understanding; probing missing concepts with follow-up.",
      };
    }

    // 5b. Phase Gate
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
        };
      }
    }

    // 6. Topic Switch Gates
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
        };
      } else {
        // No remaining topics available
        logger.info(
          `Session ${session.interviewId}: Repeated knowledge gaps and no further topics available. Concluding interview.`
        );
        return {
          action: InterviewAction.COMPLETE_INTERVIEW,
          reason: "All planned interview topics have been assessed.",
        };
      }
    }

    // Reason B: Topic Question Budget Met
    const targetQuestionsForTopic = this.getTargetQuestionsForTopic(
      session.currentTopic,
      plan
    );
    const topicCount = session.topicQuestionCount || 0;

    if (topicCount >= targetQuestionsForTopic) {
      const nextTopic = this.getNextTopic(session, plan);
      if (nextTopic) {
        logger.info(
          `Session ${session.interviewId}: Topic budget met for ${session.currentTopic} (${topicCount}/${targetQuestionsForTopic}). Switching to ${nextTopic}.`
        );
        return {
          action: InterviewAction.SWITCH_TOPIC,
          nextTopic,
          difficulty: this.determineNextDifficulty(session, plan, lastTurn),
          reason: `Target question budget met for topic ${session.currentTopic}; advancing to ${nextTopic}.`,
        };
      } else {
        // All planned topics have completed their budget
        logger.info(
          `Session ${session.interviewId}: All planned topics completed. Concluding interview.`
        );
        return {
          action: InterviewAction.COMPLETE_INTERVIEW,
          reason: "All planned interview topics have been thoroughly covered.",
        };
      }
    }

    // 7. Normal Next Question within current topic (ASK_QUESTION)
    const nextDifficulty = this.determineNextDifficulty(session, plan, lastTurn);
    return {
      action: InterviewAction.ASK_QUESTION,
      topic: session.currentTopic,
      difficulty: nextDifficulty,
      reason: `Continuing current topic ${session.currentTopic} at ${nextDifficulty} difficulty.`,
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

    // 1. Strong Performance: Candidate answers accurately
    if (answerStatus === AnswerStatus.ACCURATE) {
      // Step up difficulty only after sustained correct answers (streak >= 2)
      if (streakCorrect >= 2) {
        if (currentDiff === Difficulty.EASY) return Difficulty.MEDIUM;
        if (currentDiff === Difficulty.MEDIUM) return Difficulty.HARD;
        return Difficulty.HARD;
      }
      // Single correct answer maintains current difficulty to establish stability
      return currentDiff;
    }

    // 2. Struggling Performance: Knowledge gap or incorrect answer
    if (
      answerStatus === AnswerStatus.KNOWLEDGE_GAP ||
      answerStatus === AnswerStatus.INCORRECT
    ) {
      // Step down difficulty
      if (currentDiff === Difficulty.HARD) return Difficulty.MEDIUM;
      if (currentDiff === Difficulty.MEDIUM) return Difficulty.EASY;
      return Difficulty.EASY;
    }

    // 3. Partial Performance: Maintain current difficulty
    if (answerStatus === AnswerStatus.PARTIAL) {
      return currentDiff;
    }

    // Default fallback
    return currentDiff || Difficulty.EASY;
  }
}

export const adaptiveEngineService = new AdaptiveEngineService();
export default adaptiveEngineService;
