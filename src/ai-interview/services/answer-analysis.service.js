import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { InterviewState } from "../enums/interview-state.enum.js";
import { AnswerStatus } from "../enums/answer-status.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { aiAnswerAnalysisService } from "../ai/ai-answer-analysis.service.js";
import { conceptHistoryService } from "./concept-history.service.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

export class AnswerAnalysisService {
  constructor(ai = aiAnswerAnalysisService) {
    this.ai = ai;
  }

  /**
   * Deterministic check for explicit knowledge gap language in candidate transcript.
   * STRICT MANDATE: Explicit knowledge gaps MUST NOT trigger follow-ups or defense demands.
   *
   * @param {string} rawAnswer - Candidate answer transcript
   * @returns {boolean} True if the answer is an explicit knowledge gap
   */
  isExplicitKnowledgeGap(rawAnswer) {
    if (!rawAnswer || typeof rawAnswer !== "string") return false;
    const clean = rawAnswer.trim().toLowerCase();

    // Regex patterns for explicit admission of not knowing
    const EXPLICIT_GAP_PATTERNS = [
      /\b(?:i\s+)?(?:don'?t|do\s+not)\s+know\b/i,
      /\b(?:i'?m|i\s+am)\s+not\s+(?:really\s+)?sure\b/i,
      /\bnot\s+(?:really\s+)?sure\b/i,
      /\b(?:haven'?t|have\s+never|never)\s+(?:worked|dealt)\s+with\b/i,
      /\b(?:haven'?t|have\s+never|never)\s+used\b/i,
      /\b(?:don'?t|do\s+not)\s+remember\b/i,
      /\b(?:can'?t|cannot)\s+recall\b/i,
      /\b(?:can'?t|cannot)\s+answer\b/i,
      /\b(?:have\s+)?no\s+idea\b/i,
      /\bpass\s+(?:this\s+question|on\s+this)?\b/i,
      /\bskip\s+(?:this\s+question)?\b/i,
    ];

    const matchesPattern = EXPLICIT_GAP_PATTERNS.some((pattern) => pattern.test(clean));
    if (!matchesPattern) return false;

    // Distinguish explicit gap from a detailed answer that merely hedges (e.g. "I think X is Y, but I'm not sure if Z"):
    // If the answer is short (< 20 words) and contains gap language, it is definitely a knowledge gap.
    const wordCount = clean.split(/\s+/).filter(Boolean).length;
    if (wordCount < 20) return true;

    // If longer, check whether the knowledge gap phrase dominates the response
    const gapOnlyPatterns = [
      /^(?:sorry,?\s*)?(?:i\s+)?(?:don'?t|do\s+not)\s+know/i,
      /^(?:sorry,?\s*)?(?:i'?m|i\s+am)\s+not\s+sure/i,
      /^(?:i\s+)?(?:haven'?t|have\s+never)\s+worked\s+with/i,
    ];
    return gapOnlyPatterns.some((p) => p.test(clean));
  }

  /**
   * Analyzes an existing question turn's candidate answer.
   * Enforces backend authority: deterministic "I don't know" rules, follow-up authorization,
   * coverage state updates, and candidate performance tracking.
   *
   * @param {Object} params
   * @param {string} params.sessionId - Interview session ID
   * @param {Object} params.user - Authenticated user ({ _id, role })
   * @param {string} [params.turnId] - Specific turn ID to analyze (defaults to current turn)
   * @returns {Promise<Object>} Persisted analysis result with authorized next action recommendations
   */
  async analyzeTurnAnswer({ sessionId, user, turnId = null }) {
    if (!sessionId) {
      throw new ApiError(400, "Session ID is required for answer analysis.");
    }
    if (!user || !user._id) {
      throw new ApiError(401, "Unauthorized");
    }

    // 1. Fetch session with strict ownership check
    const query = sessionId.toString().startsWith("int-")
      ? { interviewId: sessionId }
      : { _id: sessionId };

    const session = await InterviewSession.findOne(query);
    if (!session) {
      throw new ApiError(404, `Interview session not found: ${sessionId}`);
    }

    const isOwner = session.userId.toString() === user._id.toString();
    const isAdmin = user.role === "IQPATH_ADMIN";
    if (!isOwner && !isAdmin) {
      throw new ApiError(403, "You are not authorized to analyze this interview session.");
    }

    // 2. Locate the existing InterviewTurn
    let turn = null;
    if (turnId) {
      turn = await InterviewTurn.findById(turnId);
    } else if (session.currentQuestion?.id || session.currentQuestion?.questionId) {
      const qId = session.currentQuestion.id || session.currentQuestion.questionId;
      turn = await InterviewTurn.findById(qId);
    }

    if (!turn) {
      turn = await InterviewTurn.findOne({
        sessionId: session._id,
        turnNumber: session.questionCount,
      });
    }

    if (!turn) {
      throw new ApiError(404, "No active interview turn found to analyze.");
    }

    // A "no response" turn (the response timer expired with nothing said)
    // legitimately has an empty answer — it's judged as SKIPPED below.
    const isNoResponse = turn.endedReason === "timeout_no_response";
    if ((!turn.candidateAnswer || !turn.candidateAnswer.trim()) && !isNoResponse) {
      throw new ApiError(400, "No candidate answer recorded for this turn yet.");
    }

    // 3. Duplicate Analysis Protection
    if (turn.processingState === "ANALYZED" && turn.answerStatus) {
      logger.info(`Turn ${turn.turnNumber} already analyzed; returning cached analysis.`);
      return {
        sessionId: session.interviewId,
        turnId: turn._id.toString(),
        turnNumber: turn.turnNumber,
        topic: turn.topic,
        answerStatus: turn.answerStatus,
        correctnessScore: turn.correctnessScore,
        relevanceScore: turn.relevanceScore,
        completenessScore: turn.completenessScore,
        conceptsDemonstrated: turn.conceptsDemonstrated || [],
        conceptsMissing: turn.conceptsMissing || [],
        followUpAllowed: Boolean(turn.followUp),
        feedbackSummary: turn.feedbackSummary,
        interviewState: session.interviewState,
      };
    }

    // Fetch internal plan for backend constraints
    const plan = await InterviewPlan.findById(session.planId);

    // 4. STRICT DETERMINISTIC "I DON'T KNOW" CHECK
    const isExplicitGap = !isNoResponse && this.isExplicitKnowledgeGap(turn.candidateAnswer);

    let finalStatus = AnswerStatus.PARTIAL;
    let relevance = 50;
    let correctness = 50;
    let completeness = 50;
    let confidence = 60;
    let conceptsDemonstrated = [];
    let conceptsMissing = [];
    let feedbackSummary = "";
    let aiFollowUpRecommended = false;
    let difficultyRec = turn.difficulty;
    let topicContinuation = true;

    if (isNoResponse) {
      // The candidate said/typed nothing before the response timer ran
      // out. Score it as a non-answer — no follow-up, drop difficulty a
      // notch, keep covering the topic with the next question.
      logger.info(
        `No response recorded for session ${session.interviewId} (turn ${turn.turnNumber}). Scoring as SKIPPED.`
      );
      finalStatus = AnswerStatus.SKIPPED;
      relevance = 0;
      correctness = 0;
      completeness = 0;
      confidence = 0;
      conceptsDemonstrated = [];
      conceptsMissing = [turn.topic];
      feedbackSummary = "No answer was given before the response time limit.";
      aiFollowUpRecommended = false;
      difficultyRec = Difficulty.EASY;
      topicContinuation = true;
    } else if (isExplicitGap) {
      // Deterministic Knowledge Gap Enforcement
      logger.info(
        `Explicit knowledge gap detected for session ${session.interviewId} (turn ${turn.turnNumber}). Strict no-followup enforced.`
      );
      finalStatus = AnswerStatus.KNOWLEDGE_GAP;
      relevance = 100; // Directly addressed the question by stating gap
      correctness = 0;
      completeness = 0;
      confidence = 100; // Certain in not knowing
      conceptsDemonstrated = [];
      conceptsMissing = [turn.topic];
      feedbackSummary = "Explicit knowledge gap expressed. Moving to next concept.";
      aiFollowUpRecommended = false;
      difficultyRec = Difficulty.EASY;
      topicContinuation = false;
    } else {
      // Delegate to AI Analysis Layer
      const aiResult = await this.ai.analyzeCandidateAnswer({
        question: turn.question,
        candidateAnswer: turn.candidateAnswer,
        topic: turn.topic,
        difficulty: turn.difficulty,
        role: session.role,
        experienceLevel: session.experienceLevel,
        interviewId: session.interviewId,
      });

      finalStatus = aiResult.answerStatus || AnswerStatus.PARTIAL;
      relevance = aiResult.relevanceScore ?? 70;
      correctness = aiResult.correctnessScore ?? 60;
      completeness = aiResult.completenessScore ?? 50;
      confidence = aiResult.confidence ?? 70;
      conceptsDemonstrated = aiResult.conceptsDemonstrated || [];
      conceptsMissing = aiResult.conceptsMissing || [];
      feedbackSummary = aiResult.feedbackSummary || "Candidate answer evaluated.";
      aiFollowUpRecommended = Boolean(aiResult.followUpRecommended);
      difficultyRec = aiResult.difficultyRecommendation || turn.difficulty;
      topicContinuation = aiResult.topicContinuationRecommended ?? true;
    }

    // 5. BACKEND AUTHORITY: Authorize or reject follow-up
    // Strict rules:
    // - Never follow up on KNOWLEDGE_GAP
    // - Never exceed maxFollowUpsPerQuestion (strict 1)
    // - Never exceed maxGlobalFollowUps
    // - Never follow up if timeRemaining < 120s
    // - Never follow up if consecutive knowledge gaps in topic >= 2
    let followUpAllowed = false;
    const maxFollowUpsPerQ = plan?.maxFollowUpsPerQuestion ?? 1;
    const maxGlobalFollowUps = plan?.maxGlobalFollowUps ?? 3;
    const isAlreadyFollowUp = Boolean(turn.parentTurnId || (turn.followUp && maxFollowUpsPerQ <= 1));

    if (
      !isAlreadyFollowUp &&
      !isExplicitGap &&
      finalStatus === AnswerStatus.PARTIAL &&
      aiFollowUpRecommended &&
      session.followUpCount < maxFollowUpsPerQ &&
      session.globalFollowUpCount < maxGlobalFollowUps &&
      session.timeRemaining > 120 &&
      (session.candidatePerformance?.consecutiveKnowledgeGapsInTopic || 0) < 2
    ) {
      followUpAllowed = true;
    } else {
      followUpAllowed = false;
    }

    // 6. Update the existing InterviewTurn
    turn.answerStatus = finalStatus;
    turn.relevanceScore = relevance;
    turn.correctnessScore = correctness;
    turn.completenessScore = completeness;
    turn.confidence = confidence;
    turn.conceptsDemonstrated = conceptsDemonstrated;
    turn.conceptsMissing = conceptsMissing;
    turn.feedbackSummary = feedbackSummary;
    turn.followUpRecommended = aiFollowUpRecommended;
    turn.followUpAllowed = followUpAllowed;
    if (turn.parentTurnId) {
      turn.followUp = true; // Preserve that this turn was a follow-up question
    }
    turn.difficultyRecommendation = difficultyRec;
    turn.topicContinuationRecommended = topicContinuation;
    turn.processingState = "ANALYZED";
    turn.analysisTimestamp = new Date();

    await turn.save();

    // 7. Update Session Topic Coverage State
    if (Array.isArray(session.coverageState)) {
      const topicIndex = session.coverageState.findIndex(
        (c) => c.topic.toUpperCase() === turn.topic.toUpperCase()
      );

      if (topicIndex >= 0) {
        const item = session.coverageState[topicIndex];
        if (
          finalStatus === AnswerStatus.KNOWLEDGE_GAP ||
          finalStatus === AnswerStatus.SKIPPED
        ) {
          item.knowledgeGaps = (item.knowledgeGaps || 0) + 1;
        }

        // Calculate knowledge level based on correctness score
        if (correctness >= 80) item.knowledgeLevel = "ADVANCED";
        else if (correctness >= 55) item.knowledgeLevel = "MEDIUM";
        else if (correctness >= 30) item.knowledgeLevel = "BASIC";
        else item.knowledgeLevel = "NONE";

        // Coverage formula: proportion of target questions asked
        const targetQ = plan?.maxQuestionsPerTopic || 3;
        item.coveragePercentage = Math.min(
          100,
          Math.round(((item.questionsAsked || 1) / targetQ) * 100)
        );

        session.coverageState[topicIndex] = item;
      }
    }

    // 8. Update Session Candidate Performance Tracking
    if (!session.candidatePerformance) {
      session.candidatePerformance = {
        baselineEstablished: false,
        baselineScore: 0,
        streakCorrect: 0,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
        runningAccuracy: 0,
      };
    }

    const perf = session.candidatePerformance;
    if (finalStatus === AnswerStatus.ACCURATE) {
      perf.streakCorrect = (perf.streakCorrect || 0) + 1;
      perf.streakGaps = 0;
      perf.consecutiveKnowledgeGapsInTopic = 0;
    } else if (
      finalStatus === AnswerStatus.KNOWLEDGE_GAP ||
      finalStatus === AnswerStatus.SKIPPED
    ) {
      // A no-response counts toward the topic's gap streak so repeated
      // silence eventually moves the interview on to another topic.
      perf.streakGaps = (perf.streakGaps || 0) + 1;
      perf.consecutiveKnowledgeGapsInTopic =
        (perf.consecutiveKnowledgeGapsInTopic || 0) + 1;
      perf.streakCorrect = 0;
    } else {
      perf.streakCorrect = 0;
      perf.consecutiveKnowledgeGapsInTopic = 0;
    }

    // Update running accuracy (rolling average)
    const prevAccuracy = perf.runningAccuracy || 0;
    const turnCount = session.questionCount || 1;
    perf.runningAccuracy = Math.round(
      (prevAccuracy * (turnCount - 1) + correctness) / turnCount
    );

    // Establish candidate baseline after initial turns
    if (turnCount >= 3 && !perf.baselineEstablished) {
      perf.baselineEstablished = true;
      perf.baselineScore = perf.runningAccuracy;
      logger.info(`Baseline established for candidate in session ${session.interviewId}: ${perf.baselineScore}%`);
    }

    session.candidatePerformance = perf;

    // 9. Advance Interview State to WAITING_FOR_NEXT_QUESTION
    session.interviewState = InterviewState.WAITING_FOR_NEXT_QUESTION;

    await session.save();

    // Fold this turn into the candidate's cross-interview concept history
    // (non-fatal — used only to inform future difficulty choices).
    await conceptHistoryService.recordTurn(session.userId, turn);

    logger.info(
      `Turn ${turn.turnNumber} analyzed for session ${session.interviewId}: status=${finalStatus}, score=${correctness}, followUpAllowed=${followUpAllowed}`
    );

    return {
      sessionId: session.interviewId,
      turnId: turn._id.toString(),
      turnNumber: turn.turnNumber,
      topic: turn.topic,
      answerStatus: turn.answerStatus,
      correctnessScore: turn.correctnessScore,
      relevanceScore: turn.relevanceScore,
      completenessScore: turn.completenessScore,
      conceptsDemonstrated: turn.conceptsDemonstrated,
      conceptsMissing: turn.conceptsMissing,
      followUpAllowed,
      feedbackSummary: turn.feedbackSummary,
      interviewState: session.interviewState,
    };
  }
}

export const answerAnalysisService = new AnswerAnalysisService();
export default answerAnalysisService;
