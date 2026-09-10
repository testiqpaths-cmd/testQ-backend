import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

export class InterviewPlanService {
  /**
   * Generates and persists an internal InterviewPlan for an interview session.
   *
   * @param {Object} params
   * @param {string} [params.sessionId] - Associated session ID
   * @param {string[]} params.topics - Ordered topics to cover
   * @param {number} [params.duration=30] - Total interview duration in minutes
   * @param {string} [params.difficulty="ADAPTIVE"] - Difficulty mode
   * @param {number} [params.userQuestionLimit] - Optional target question count
   * @returns {Promise<InterviewPlan>} Persisted InterviewPlan document
   */
  async createPlan({
    sessionId = null,
    topics = [],
    duration = 30,
    difficulty = Difficulty.ADAPTIVE,
    userQuestionLimit = null,
  }) {
    if (!Array.isArray(topics) || topics.length === 0) {
      throw new ApiError(400, "Interview plan requires at least one topic.");
    }

    const safeDuration = Math.min(120, Math.max(5, Number(duration) || 30));

    // Calculate global question limit based on duration (~3-4 min per question)
    let globalQuestionLimit;
    if (userQuestionLimit && Number(userQuestionLimit) >= 3 && Number(userQuestionLimit) <= 30) {
      globalQuestionLimit = Number(userQuestionLimit);
    } else {
      globalQuestionLimit = Math.min(
        25,
        Math.max(4, Math.round(safeDuration / 3.5))
      );
    }

    // Maximum questions per individual topic (upper bound, typically 3-5)
    const maxQuestionsPerTopic = Math.min(
      5,
      Math.max(2, Math.ceil(globalQuestionLimit / topics.length) + 1)
    );

    // Strict follow-up caps enforced by backend:
    // - Never more than 1 follow-up on a single question
    // - Global follow-up cap proportional to length
    const maxFollowUpsPerQuestion = 1;
    const maxGlobalFollowUps = Math.min(
      5,
      Math.max(1, Math.floor(globalQuestionLimit / 4))
    );

    // Allocate time & question budgets across topics
    const allocatedMinutesPerTopic = Math.max(
      2,
      Math.floor(safeDuration / topics.length)
    );
    const targetQuestionsPerTopic = Math.max(
      1,
      Math.floor(globalQuestionLimit / topics.length)
    );

    const topicBudgets = topics.map((topic) => ({
      topic: String(topic).toUpperCase(),
      targetQuestions: targetQuestionsPerTopic,
      allocatedMinutes: allocatedMinutesPerTopic,
    }));

    const plan = new InterviewPlan({
      sessionId,
      duration: safeDuration,
      topics: topics.map((t) => String(t).toUpperCase()),
      difficulty: difficulty.toUpperCase(),
      maxQuestionsPerTopic,
      maxFollowUpsPerQuestion,
      maxGlobalFollowUps,
      globalQuestionLimit,
      topicBudgets,
    });

    return await plan.save();
  }
}

export const interviewPlanService = new InterviewPlanService();
export default interviewPlanService;
