import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { InterviewState } from "../enums/interview-state.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { aiQuestionService } from "../ai/ai-question.service.js";
import { conceptHistoryService } from "./concept-history.service.js";
import { questionDedupService } from "./question-dedup.service.js";
import { questionAudioService } from "../tts/question-audio.service.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const DIFFICULTY_LADDER = ["EASY", "MEDIUM", "HARD"];

export class QuestionService {
  constructor(ai = aiQuestionService) {
    this.ai = ai;
  }

  bumpDifficulty(current, delta) {
    const i = DIFFICULTY_LADDER.indexOf(String(current || "EASY").toUpperCase());
    if (i < 0) return current;
    const next = Math.min(DIFFICULTY_LADDER.length - 1, Math.max(0, i + delta));
    return DIFFICULTY_LADDER[next];
  }

  /**
   * Runs an AI question generator, then guards against a candidate being
   * asked a question they've already had (in this or any earlier
   * interview) reworded — using embedding cosine similarity. On a hit it
   * regenerates ONCE with the duplicate added to the exclusion list.
   *
   * Fully non-fatal / no-op without an AI key: `embedQuestion` returns null
   * (no embedding to compare), so the first result is used as-is.
   *
   * @param {(excludeQuestions: string[]) => Promise<Object>} generate
   * @param {{ userId: any, interviewId: string, topic: string }} ctx
   * @returns {Promise<{ aiOutput: Object, questionEmbedding: number[]|null }>}
   */
  async generateWithDedup(generate, { userId, interviewId, topic, sessionQuestions = [] }) {
    let aiOutput = await generate([]);
    let embedding = await questionDedupService.embedQuestion(aiOutput.question, interviewId);

    const dup = await questionDedupService.findDuplicate(embedding, userId, {
      topic,
      questionText: aiOutput.question,
      sessionQuestions,
    });
    if (dup.isDuplicate) {
      logger.info(
        `Dedup: regenerating near-duplicate question (${dup.reason || "cosine"} ${dup.similarity.toFixed(3)} vs "${(dup.closestMatch?.question || "").slice(0, 70)}")`
      );
      const exclude = [aiOutput.question, dup.closestMatch?.question].filter(Boolean);
      const retry = await generate(exclude);
      const retryEmbedding = await questionDedupService.embedQuestion(retry.question, interviewId);
      aiOutput = retry;
      embedding = retryEmbedding || embedding;
    }

    return { aiOutput, questionEmbedding: embedding };
  }

  /**
   * Determine baseline difficulty for initial questions.
   * Requirement: Establish candidate baseline first (Q1 = EASY; respects plan difficulty bounds).
   */
  determineBaselineDifficulty(planDifficulty, questionIndex = 1) {
    const normPlanDiff = (planDifficulty || "ADAPTIVE").toUpperCase();
    if (normPlanDiff === Difficulty.HARD) {
      return questionIndex === 1 ? Difficulty.MEDIUM : Difficulty.HARD;
    }
    if (normPlanDiff === Difficulty.MEDIUM) {
      return questionIndex === 1 ? Difficulty.EASY : Difficulty.MEDIUM;
    }
    // ADAPTIVE or EASY starts at EASY for candidate baseline establishment
    return Difficulty.EASY;
  }

  /**
   * Generate and persist the first question for an interview session.
   *
   * @param {Object} session - Mongoose InterviewSession document
   * @param {Object} plan - Mongoose InterviewPlan document
   * @returns {Promise<Object>} Formatted question payload for candidate room
   */
  async generateFirstQuestion(session, plan) {
    // 1. Backend Validation Checks before Question Generation
    if (!session) {
      throw new ApiError(400, "Session is required for question generation.");
    }

    if (
      session.interviewState !== InterviewState.READY &&
      session.interviewState !== InterviewState.IN_PROGRESS
    ) {
      throw new ApiError(
        400,
        `Cannot generate first question: session is in state ${session.interviewState}.`
      );
    }

    // Check duration expiration
    if (session.timeRemaining <= 0) {
      throw new ApiError(400, "Interview duration has expired.");
    }

    // 2. The first question of every interview is ALWAYS the introductory question
    const introQuestionText =
      "Tell me about yourself, your background, and what you've been working on recently.";
    const finalTopic = "INTRODUCTION";
    const finalDifficulty = Difficulty.EASY;
    const finalConcept = "Introduction";
    const finalCompetency = "Communication & Background";
    const finalQuestionType = "BEHAVIORAL";

    // 3. Persist InterviewTurn in Database
    const turn = new InterviewTurn({
      sessionId: session._id,
      interviewId: session.interviewId,
      turnNumber: 1,
      topic: finalTopic,
      question: introQuestionText,
      concept: finalConcept,
      questionType: finalQuestionType,
      difficulty: finalDifficulty,
      competency: finalCompetency,
      questionSource: "predefined",
      questionBankId: null,
      questionTimestamp: new Date(),
    });

    await turn.save();

    // Warm the question's narration now so it's ready when the room asks.
    questionAudioService.prewarmForTurn(turn._id, turn.question, {
      interviewId: session.interviewId,
    });

    // 4. Update Session State (Backend Authority)
    session.currentTopic = finalTopic;
    session.currentQuestion = {
      id: turn._id.toString(),
      questionId: turn._id.toString(),
      turnNumber: 1,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
      questionType: turn.questionType,
      competency: turn.competency,
      concept: turn.concept || null,
      timestamp: turn.questionTimestamp,
      isFollowUp: false,
      subIndex: null,
    };
    session.questionCount = 1;
    session.topicQuestionCount = 1;

    // Update topic coverage state
    if (Array.isArray(session.coverageState)) {
      const topicIndex = session.coverageState.findIndex(
        (c) => c.topic.toUpperCase() === finalTopic
      );
      if (topicIndex >= 0) {
        session.coverageState[topicIndex].questionsAsked = 1;
        session.coverageState[topicIndex].status = "IN_PROGRESS";
      } else {
        session.coverageState.unshift({
          topic: finalTopic,
          questionsAsked: 1,
          knowledgeGaps: 0,
          coveragePercentage: 100,
          knowledgeLevel: "NONE",
          status: "IN_PROGRESS",
        });
      }
    }

    logger.info(
      `First question generated for interview ${session.interviewId} (turn 1, topic: ${finalTopic}, diff: ${finalDifficulty})`
    );

    return {
      id: turn._id.toString(),
      questionId: turn._id.toString(),
      turnNumber: 1,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
      questionType: turn.questionType,
      competency: turn.competency,
      concept: turn.concept || null,
      timestamp: turn.questionTimestamp,
      isFollowUp: false,
      subIndex: null,
    };
  }

  /**
   * Generates the next regular question for the interview session.
   * Handles topic questions, difficulty adaptation, turns persistence, and coverage tracking.
   *
   * @param {Object} session - Mongoose InterviewSession
   * @param {Object} plan - Mongoose InterviewPlan
   * @param {Object} params
   * @param {string} params.topic - Active or switched topic
   * @param {string} params.difficulty - Target difficulty
   * @returns {Promise<Object>} Formatted question payload
   */
  async generateNextQuestion(session, plan, { topic, difficulty }) {
    if (!session) {
      throw new ApiError(400, "Session is required for question generation.");
    }

    const activeTopic = (topic || session.currentTopic || "TECHNICAL_FUNDAMENTALS").toUpperCase();
    let targetDifficulty = (difficulty || session.difficulty || Difficulty.EASY).toUpperCase();

    // If we're moving into a topic the candidate has strong prior history
    // on (across earlier interviews), start it one notch harder — and one
    // notch easier if they've historically struggled. Only applies to the
    // first question of a topic (topicQuestionCount <= 1) and never for a
    // plan that pins a fixed difficulty.
    if ((session.topicQuestionCount || 0) <= 1 && (plan?.difficulty === "ADAPTIVE" || !plan?.difficulty)) {
      const prior = await conceptHistoryService.getTopicBestScore(session.userId, activeTopic);
      if (prior != null) {
        if (prior >= 75) targetDifficulty = this.bumpDifficulty(targetDifficulty, +1);
        else if (prior < 40) targetDifficulty = this.bumpDifficulty(targetDifficulty, -1);
      }
    }

    // Fetch previous questions and concepts asked in this session to prevent repetition
    let previousQuestions = [];
    let conceptsAlreadyTested = [];
    try {
      const pastTurns = await InterviewTurn.find({ sessionId: session._id })
        .select("question concept")
        .lean();
      previousQuestions = pastTurns.map((t) => t.question).filter(Boolean);
      conceptsAlreadyTested = pastTurns.map((t) => t.concept).filter(Boolean);
    } catch {
      // Non-fatal if query fails
    }

    // Generate question via AI layer (with automatic fallback +
    // cross-interview semantic dedup)
    const { aiOutput, questionEmbedding } = await this.generateWithDedup(
      (exclude) =>
        this.ai.generateQuestion({
          role: session.role,
          experienceLevel: session.experienceLevel,
          topic: activeTopic,
          difficulty: targetDifficulty,
          previousQuestions: [...previousQuestions, ...exclude],
          conceptsAlreadyTested,
          resumeSkills: session.resumeData?.extracted?.skills || session.techStack || [],
          interviewType: session.interviewTypes?.[0] || "technical",
          interviewId: session.interviewId,
        }),
      { userId: session.userId, interviewId: session.interviewId, topic: activeTopic, sessionQuestions: previousQuestions }
    );

    const finalQuestion = aiOutput.question.trim();
    const finalTopic = String(aiOutput.topic || activeTopic).toUpperCase();
    const finalDifficulty = String(aiOutput.difficulty || targetDifficulty).toUpperCase();
    const finalConcept = aiOutput.concept || null;

    // Determine sequential turnNumber across all session turns
    const lastTurnDoc = await InterviewTurn.findOne({ sessionId: session._id })
      .sort({ turnNumber: -1 })
      .select("turnNumber");
    const nextTurnNumber = (lastTurnDoc?.turnNumber || 0) + 1;

    // Persist new InterviewTurn
    const turn = new InterviewTurn({
      sessionId: session._id,
      interviewId: session.interviewId,
      turnNumber: nextTurnNumber,
      topic: finalTopic,
      question: finalQuestion,
      concept: finalConcept,
      questionEmbedding: questionEmbedding || undefined,
      questionType: aiOutput.questionType || "TECHNICAL",
      difficulty: finalDifficulty,
      competency: aiOutput.competency || "Technical Knowledge",
      questionSource: aiOutput.questionSource || "ai_generated",
      questionBankId: aiOutput.questionBankId || null,
      questionTimestamp: new Date(),
      processingState: "QUESTION_GENERATED",
    });

    await turn.save();

    questionAudioService.prewarmForTurn(turn._id, turn.question, {
      interviewId: session.interviewId,
    });

    // Update session state (primary question count increments)
    session.currentTopic = finalTopic;
    session.difficulty = finalDifficulty;
    session.questionCount = (session.questionCount || 0) + 1;
    session.currentQuestion = {
      id: turn._id.toString(),
      questionId: turn._id.toString(),
      turnNumber: nextTurnNumber,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
      questionType: turn.questionType,
      competency: turn.competency,
      concept: turn.concept || null,
      timestamp: turn.questionTimestamp,
      isFollowUp: false,
      subIndex: null,
    };

    // Update topic coverage state
    if (Array.isArray(session.coverageState)) {
      const topicIndex = session.coverageState.findIndex(
        (c) => c.topic.toUpperCase() === finalTopic
      );
      const targetQ = plan?.maxQuestionsPerTopic || 3;

      if (topicIndex >= 0) {
        const item = session.coverageState[topicIndex];
        item.questionsAsked = (item.questionsAsked || 0) + 1;
        item.status = "IN_PROGRESS";
        item.coveragePercentage = Math.min(
          100,
          Math.round((item.questionsAsked / targetQ) * 100)
        );
        session.coverageState[topicIndex] = item;
      } else {
        session.coverageState.push({
          topic: finalTopic,
          questionsAsked: 1,
          knowledgeGaps: 0,
          coveragePercentage: Math.min(100, Math.round((1 / targetQ) * 100)),
          knowledgeLevel: "NONE",
          status: "IN_PROGRESS",
        });
      }
    }

    logger.info(
      `Next question generated for session ${session.interviewId} (turn ${nextTurnNumber}, primary Q# ${session.questionCount}, topic: ${finalTopic}, diff: ${finalDifficulty})`
    );

    return {
      id: turn._id.toString(),
      questionId: turn._id.toString(),
      turnNumber: nextTurnNumber,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
      questionType: turn.questionType,
      competency: turn.competency,
      concept: turn.concept || null,
      timestamp: turn.questionTimestamp,
      isFollowUp: false,
      subIndex: null,
    };
  }

  /**
   * Generates a follow-up question for a partial answer on an existing turn.
   * Links to parent turn, persists new turn with followUp=true, updates session.
   * STRICT: Follow-ups do NOT consume primary questionCount or topicQuestionCount budgets.
   *
   * @param {Object} session - Mongoose InterviewSession
   * @param {Object} plan - Mongoose InterviewPlan
   * @param {Object} previousTurn - Mongoose InterviewTurn
   * @returns {Promise<Object>} Formatted follow-up question payload
   */
  async generateFollowUpQuestion(session, plan, previousTurn) {
    if (!session || !previousTurn) {
      throw new ApiError(400, "Session and previous turn are required for follow-up.");
    }

    let previousQuestions = [];
    try {
      const pastTurns = await InterviewTurn.find({ sessionId: session._id })
        .select("question")
        .lean();
      previousQuestions = pastTurns.map((t) => t.question).filter(Boolean);
    } catch {
      // Non-fatal
    }

    const aiOutput = await this.ai.generateFollowUpQuestion({
      role: session.role,
      experienceLevel: session.experienceLevel,
      topic: previousTurn.topic,
      difficulty: previousTurn.difficulty,
      previousQuestion: previousTurn.question,
      previousQuestions,
      candidateAnswer: previousTurn.candidateAnswer || "",
      conceptsMissing: previousTurn.conceptsMissing || [],
      conceptsDemonstrated: previousTurn.conceptsDemonstrated || [],
      interviewId: session.interviewId,
    });

    const finalQuestion = aiOutput.question.trim();
    const finalConcept = aiOutput.concept || previousTurn.concept || null;

    // Embed for future dedup comparisons; follow-ups are inherently tied to
    // the parent answer so we don't regenerate them, just record the vector.
    const questionEmbedding = await questionDedupService.embedQuestion(
      finalQuestion,
      session.interviewId
    );

    // Determine sequential turnNumber across all session turns
    const lastTurnDoc = await InterviewTurn.findOne({ sessionId: session._id })
      .sort({ turnNumber: -1 })
      .select("turnNumber");
    const nextTurnNumber = (lastTurnDoc?.turnNumber || 0) + 1;

    // Persist new InterviewTurn linked to parent turn
    const turn = new InterviewTurn({
      sessionId: session._id,
      interviewId: session.interviewId,
      turnNumber: nextTurnNumber,
      topic: previousTurn.topic,
      question: finalQuestion,
      concept: finalConcept,
      questionEmbedding: questionEmbedding || undefined,
      questionType: aiOutput.questionType || "TECHNICAL",
      difficulty: previousTurn.difficulty,
      competency: aiOutput.competency || "Technical Knowledge",
      questionSource: aiOutput.questionSource || "ai_generated",
      questionBankId: aiOutput.questionBankId || null,
      questionTimestamp: new Date(),
      processingState: "QUESTION_GENERATED",
      followUp: true,
      isFollowUp: true,
      subIndex: "b",
      parentTurnId: previousTurn._id,
    });

    await turn.save();

    questionAudioService.prewarmForTurn(turn._id, turn.question, {
      interviewId: session.interviewId,
    });

    // Update session state: follow-ups do NOT increment questionCount or topicQuestionCount
    session.currentQuestion = {
      id: turn._id.toString(),
      questionId: turn._id.toString(),
      turnNumber: nextTurnNumber,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
      questionType: turn.questionType,
      competency: turn.competency,
      concept: turn.concept || null,
      timestamp: turn.questionTimestamp,
      isFollowUp: true,
      subIndex: "b",
      parentTurnId: previousTurn._id.toString(),
    };

    logger.info(
      `Follow-up question generated for session ${session.interviewId} (turn ${nextTurnNumber}, parent turn ${previousTurn.turnNumber}, primary Q# ${session.questionCount})`
    );

    return {
      id: turn._id.toString(),
      questionId: turn._id.toString(),
      turnNumber: nextTurnNumber,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
      questionType: turn.questionType,
      competency: turn.competency,
      concept: turn.concept || null,
      timestamp: turn.questionTimestamp,
      isFollowUp: true,
      subIndex: "b",
      parentTurnId: previousTurn._id.toString(),
    };
  }
}

export const questionService = new QuestionService();
export default questionService;
