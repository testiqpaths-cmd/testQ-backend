import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewState } from "../enums/interview-state.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { interviewPlanService } from "./interview-plan.service.js";
import { resumeService } from "../resume/resume.service.js";
import { resumeTopicService } from "../resume/resume-topic.service.js";
import { questionService } from "./question.service.js";
import { InterviewAction } from "../enums/interview-action.enum.js";
import { adaptiveEngineService } from "./adaptive-engine.service.js";
import { answerAnalysisService } from "./answer-analysis.service.js";
import { interviewResultsService } from "./interview-results.service.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

export class InterviewSessionService {
  /**
   * Generates a readable unique interview session ID
   */
  generateInterviewId() {
    return `int-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Path B: "Set Up Your Own Interview" (Custom Interview)
   * Validates configuration, builds plan, initializes session in READY state.
   */
  async createCustomInterview(userId, payload) {
    if (!userId) {
      throw new ApiError(401, "User authentication required to create an interview.");
    }

    const role =
      payload.role ||
      (Array.isArray(payload.roles) && payload.roles[0]) ||
      "Software Engineer";

    const techStack = Array.isArray(payload.technologies)
      ? payload.technologies
      : Array.isArray(payload.techStack)
      ? payload.techStack
      : [];

    const duration = Number(payload.duration || payload.durationMinutes || 30);
    const difficulty = (payload.difficulty || Difficulty.ADAPTIVE).toUpperCase();
    const company = (payload.company || "").trim();
    const experienceLevel = payload.experienceLevel || payload.experience || "1-3 Years";
    const interviewTypes = Array.isArray(payload.interviewTypes) && payload.interviewTypes.length
      ? payload.interviewTypes
      : payload.interviewType
      ? [payload.interviewType]
      : ["technical"];

    // Determine scoped topics from selected tech or role
    let topics = [];
    if (techStack.length > 0) {
      topics = techStack.map((t) => String(t).toUpperCase());
    } else {
      topics = resumeTopicService.selectInterviewTopics({
        role,
        duration,
        experienceLevel,
      });
    }

    // Always ensure at least 1 topic
    if (topics.length === 0) {
      topics = ["TECHNICAL_FUNDAMENTALS", "PROBLEM_SOLVING"];
    }

    const interviewId = this.generateInterviewId();

    // 1. Create Internal Backend InterviewPlan
    const plan = await interviewPlanService.createPlan({
      topics,
      duration,
      difficulty,
      userQuestionLimit: payload.questionCount,
    });

    // 2. Initialize Topic Coverage State
    const coverageState = topics.map((topic) => ({
      topic,
      questionsAsked: 0,
      knowledgeGaps: 0,
      coveragePercentage: 0,
      knowledgeLevel: "NONE",
      status: "PENDING",
    }));

    // 3. Create Session with Backend Authority Defaults
    const session = new InterviewSession({
      userId,
      interviewId,
      interviewType: "CUSTOM",
      role,
      experienceLevel,
      company,
      techStack,
      interviewTypes,
      duration,
      difficulty,
      timeRemaining: duration * 60,
      currentTopic: topics[0],
      currentQuestion: null,
      questionCount: 0,
      topicQuestionCount: 0,
      followUpCount: 0,
      globalFollowUpCount: 0,
      coverageState,
      candidatePerformance: {
        baselineEstablished: false,
        baselineScore: 0,
        streakCorrect: 0,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
        runningAccuracy: 0,
      },
      interviewState: InterviewState.READY,
      allowedTopics: topics,
      topicOrder: topics,
      planId: plan._id,
      resumeData: null,
    });

    await session.save();

    // Link session ID on plan
    plan.sessionId = session._id;
    await plan.save();

    logger.info(`InterviewSession created: ${interviewId} for user ${userId}`);

    return {
      sessionId: session.interviewId,
      _id: session._id,
      interviewId: session.interviewId,
      role: session.role,
      duration: session.duration,
      durationMinutes: session.duration,
      difficulty: session.difficulty,
      allowedTopics: session.allowedTopics,
      totalQuestions: plan.globalQuestionLimit,
      interviewState: session.interviewState,
      status: session.interviewState,
      createdAt: session.createdAt,
    };
  }

  /**
   * Path A: "Interview With My Resume"
   * Validates file, parses content, scopes relevant topics, initializes session.
   */
  async createResumeInterview(userId, file, payload = {}) {
    if (!userId) {
      throw new ApiError(401, "User authentication required to create an interview.");
    }

    const duration = Number(payload.duration || payload.durationMinutes || 30);
    const difficulty = (payload.difficulty || Difficulty.ADAPTIVE).toUpperCase();
    const role =
      payload.role ||
      (Array.isArray(payload.roles) && payload.roles[0]) ||
      "Software Engineer";
    const company = (payload.company || "").trim();
    const experienceLevel = payload.experienceLevel || payload.experience || "1-3 Years";

    let resumeData = null;
    let scopedTopics = [];

    if (file) {
      // Process uploaded resume file
      const processed = await resumeService.processResume(file, {
        role,
        duration,
        experienceLevel,
      });

      resumeData = {
        filename: processed.filename,
        sizeBytes: processed.sizeBytes,
        extracted: processed.extracted,
      };
      scopedTopics = processed.scopedTopics;
    } else if (payload.resumeId) {
      // A previously uploaded+saved resume (see resumeService.uploadAndSaveResume) —
      // recompute topics from its cached skills rather than reusing its
      // cached scopedTopics verbatim, since role/duration/experienceLevel
      // are only finalized in this "confirm interview settings" step, which
      // can differ from what was set at upload time.
      const saved = await resumeService.getByResumeId(userId, payload.resumeId);
      resumeData = {
        filename: saved.filename,
        sizeBytes: saved.sizeBytes,
        extracted: saved.extracted,
      };
      scopedTopics = resumeTopicService.selectInterviewTopics({
        role,
        candidateSkills: saved.extracted?.skills || [],
        duration,
        experienceLevel,
      });
    } else if (payload.resumeData) {
      // Direct structured resume data provided
      resumeData = payload.resumeData;
      scopedTopics = resumeTopicService.selectInterviewTopics({
        role,
        candidateSkills: payload.resumeData.skills || [],
        duration,
        experienceLevel,
      });
    } else {
      throw new ApiError(400, "Please upload a resume file (PDF or DOCX).");
    }

    if (!scopedTopics || scopedTopics.length === 0) {
      scopedTopics = ["TECHNICAL_FUNDAMENTALS", "PROBLEM_SOLVING"];
    }

    const interviewId = this.generateInterviewId();

    // 1. Create Internal Backend InterviewPlan
    const plan = await interviewPlanService.createPlan({
      topics: scopedTopics,
      duration,
      difficulty,
      userQuestionLimit: payload.questionCount,
    });

    // 2. Initialize Topic Coverage
    const coverageState = scopedTopics.map((topic) => ({
      topic,
      questionsAsked: 0,
      knowledgeGaps: 0,
      coveragePercentage: 0,
      knowledgeLevel: "NONE",
      status: "PENDING",
    }));

    // 3. Create Session
    const session = new InterviewSession({
      userId,
      interviewId,
      interviewType: "RESUME",
      role,
      experienceLevel,
      company,
      techStack: resumeData?.extracted?.skills || [],
      interviewTypes: ["technical"],
      duration,
      difficulty,
      timeRemaining: duration * 60,
      currentTopic: scopedTopics[0],
      currentQuestion: null,
      questionCount: 0,
      topicQuestionCount: 0,
      followUpCount: 0,
      globalFollowUpCount: 0,
      coverageState,
      candidatePerformance: {
        baselineEstablished: false,
        baselineScore: 0,
        streakCorrect: 0,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
        runningAccuracy: 0,
      },
      interviewState: InterviewState.READY,
      allowedTopics: scopedTopics,
      topicOrder: scopedTopics,
      planId: plan._id,
      resumeData,
    });

    await session.save();

    plan.sessionId = session._id;
    await plan.save();

    logger.info(`Resume InterviewSession created: ${interviewId} for user ${userId}`);

    return {
      sessionId: session.interviewId,
      _id: session._id,
      interviewId: session.interviewId,
      role: session.role,
      duration: session.duration,
      durationMinutes: session.duration,
      difficulty: session.difficulty,
      allowedTopics: session.allowedTopics,
      totalQuestions: plan.globalQuestionLimit,
      interviewState: session.interviewState,
      status: session.interviewState,
      resumeData: {
        filename: resumeData?.filename,
        detectedSkills: resumeData?.extracted?.skills || [],
      },
      createdAt: session.createdAt,
    };
  }

  /**
   * Retrieves an interview session by interviewId or MongoDB _id,
   * strictly enforcing session ownership / authorization.
   */
  async getSessionById(sessionId, user) {
    if (!sessionId) {
      throw new ApiError(400, "Session ID is required.");
    }
    if (!user || !user._id) {
      throw new ApiError(401, "Unauthorized");
    }

    const query = sessionId.toString().startsWith("int-")
      ? { interviewId: sessionId }
      : { _id: sessionId };

    const session = await InterviewSession.findOne(query).populate("planId");

    if (!session) {
      throw new ApiError(404, `Interview session not found: ${sessionId}`);
    }

    // Strict Authorization Check: Candidate can only access their own session
    const isOwner = session.userId.toString() === user._id.toString();
    const isAdmin = user.role === "IQPATH_ADMIN";

    if (!isOwner && !isAdmin) {
      logger.warn(`Unauthorized interview session access attempt by user ${user._id} on session ${sessionId}`);
      throw new ApiError(403, "You are not authorized to view this interview session.");
    }

    return session;
  }

  /**
   * List interview sessions for a specific user (paginated)
   */
  async getUserSessions(userId, { page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      InterviewSession.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      InterviewSession.countDocuments({ userId }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.interviewId,
        sessionId: item.interviewId,
        role: item.role,
        company: item.company,
        experience: item.experienceLevel,
        difficulty: item.difficulty,
        duration: item.duration,
        questionCount: item.questionCount,
        interviewTypes: item.interviewTypes,
        status: item.interviewState,
        score: item.resultsSummary?.score ?? null,
        readinessScore: item.resultsSummary?.readinessScore ?? null,
        date: item.createdAt,
        createdAt: item.createdAt,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  /**
   * POST /ai-interview/:id/start
   * Starts interview session: verifies ownership, checks READY state, sets timing,
   * transitions to IN_PROGRESS, and generates the first baseline question.
   */
  async startInterview(sessionId, user) {
    const session = await this.getSessionById(sessionId, user);

    // Idempotency: If already in progress and has a current question, return active state
    if (session.interviewState === InterviewState.IN_PROGRESS && session.currentQuestion) {
      const plan = await InterviewPlan.findById(session.planId);
      return {
        sessionId: session.interviewId,
        interviewId: session.interviewId,
        status: session.interviewState,
        interviewState: session.interviewState,
        totalQuestions: plan?.globalQuestionLimit || 10,
        durationMinutes: session.duration,
        timeRemaining: session.timeRemaining,
        questionIndex: session.questionCount || 1,
        currentQuestion: session.currentQuestion,
        role: session.role,
        company: session.company,
        interviewType: session.interviewTypes?.[0] || "technical",
      };
    }

    // Strict state validation: Only READY (or CREATED) sessions can be started
    if (
      session.interviewState !== InterviewState.READY &&
      session.interviewState !== InterviewState.CREATED
    ) {
      throw new ApiError(
        400,
        `Cannot start interview: session is currently ${session.interviewState}.`
      );
    }

    // Timing and active topic setup
    const now = new Date();
    session.startTime = now;
    session.endTime = new Date(now.getTime() + session.duration * 60 * 1000);
    session.timeRemaining = session.duration * 60;
    session.interviewState = InterviewState.IN_PROGRESS;

    // Initialize current topic
    const firstTopic =
      (session.topicOrder && session.topicOrder[0]) ||
      (session.allowedTopics && session.allowedTopics[0]) ||
      "TECHNICAL_FUNDAMENTALS";
    session.currentTopic = firstTopic;

    // Retrieve internal plan
    const plan = await InterviewPlan.findById(session.planId);
    if (!plan) {
      throw new ApiError(404, "Interview plan not found for this session.");
    }

    // Generate first question (delegates to QuestionService with backend limits & fallback)
    const firstQuestion = await questionService.generateFirstQuestion(session, plan);

    await session.save();

    logger.info(`Interview started: ${session.interviewId} by user ${user._id}`);

    return {
      sessionId: session.interviewId,
      interviewId: session.interviewId,
      status: session.interviewState,
      interviewState: session.interviewState,
      totalQuestions: plan.globalQuestionLimit,
      durationMinutes: session.duration,
      timeRemaining: session.timeRemaining,
      questionIndex: 1,
      currentQuestion: firstQuestion,
      role: session.role,
      company: session.company,
      interviewType: session.interviewTypes?.[0] || "technical",
    };
  }

  /**
   * POST /ai-interview/:id/answer
   * Submits and persists candidate answer for current turn.
   * Updates existing InterviewTurn, enforces duplicate protection,
   * transitions state to WAITING_FOR_NEXT_QUESTION.
   */
  async submitAnswer(sessionId, user, payload) {
    const session = await this.getSessionById(sessionId, user);

    // 1. State Gate: Only accept answers when IN_PROGRESS or PROCESSING_ANSWER
    if (
      session.interviewState !== InterviewState.IN_PROGRESS &&
      session.interviewState !== InterviewState.PROCESSING_ANSWER
    ) {
      throw new ApiError(
        400,
        `Cannot submit answer: session is currently in state ${session.interviewState}.`
      );
    }

    // 2. Active Question Gate
    if (!session.currentQuestion) {
      throw new ApiError(400, "No active interview question found to answer.");
    }

    // 3. Extract & Validate Answer text
    const answerText = (payload.answer || payload.transcript || "").trim();
    if (!answerText) {
      throw new ApiError(400, "Candidate answer or transcript cannot be empty.");
    }

    // 4. Find the existing InterviewTurn created in Phase 2
    let turn = null;
    if (session.currentQuestion.id || session.currentQuestion.questionId) {
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
      throw new ApiError(404, "Active interview turn not found for current question.");
    }

    // 5. Idempotency & Duplicate Submission Protection
    if (turn.candidateAnswer) {
      if (turn.candidateAnswer.trim() === answerText) {
        // Idempotent retry: return existing confirmation
        return {
          sessionId: session.interviewId,
          turnId: turn._id.toString(),
          turnNumber: turn.turnNumber,
          interviewState: session.interviewState,
          answerSaved: true,
          questionId: turn._id.toString(),
        };
      }
      throw new ApiError(
        409,
        "An answer has already been submitted for this interview question."
      );
    }

    // 6. Transition State to PROCESSING_ANSWER
    session.interviewState = InterviewState.PROCESSING_ANSWER;

    // Calculate time taken
    const now = new Date();
    let timeTaken = Number(payload.timeTakenSeconds);
    if (!timeTaken && turn.questionTimestamp) {
      timeTaken = Math.max(
        1,
        Math.round((now.getTime() - new Date(turn.questionTimestamp).getTime()) / 1000)
      );
    }

    // 7. Update the existing InterviewTurn (Do NOT create a second turn)
    turn.candidateAnswer = answerText;
    turn.answerTimestamp = now;
    turn.timeTakenSeconds = timeTaken || null;
    turn.audioReference = payload.audioReference || null;
    turn.processingState = "SUBMITTED";

    await turn.save();

    // 8. Deduct elapsed time and advance state to WAITING_FOR_NEXT_QUESTION
    if (timeTaken && session.timeRemaining > 0) {
      session.timeRemaining = Math.max(0, session.timeRemaining - timeTaken);
    }
    session.interviewState = InterviewState.WAITING_FOR_NEXT_QUESTION;

    await session.save();

    logger.info(
      `Answer submitted for session ${session.interviewId} (turn ${turn.turnNumber}, length: ${answerText.length} chars)`
    );

    return {
      sessionId: session.interviewId,
      turnId: turn._id.toString(),
      turnNumber: turn.turnNumber,
      interviewState: session.interviewState,
      answerSaved: true,
      questionId: turn._id.toString(),
    };
  }

  /**
   * POST /ai-interview/:id/next & POST /ai-interview/sessions/:id/next
   * Orchestrates the next interview step via AdaptiveEngine:
   * Analyzes active turn (if not yet analyzed), determines next action
   * (ASK_QUESTION, FOLLOW_UP, SWITCH_TOPIC, COMPLETE_INTERVIEW), executes it,
   * updates state/counters, and returns structured result.
   */
  async processNextAction(sessionId, user) {
    const session = await this.getSessionById(sessionId, user);

    // 1. Terminal / Inactive State Gate
    if (session.interviewState === InterviewState.COMPLETED) {
      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.COMPLETE_INTERVIEW,
        interviewState: InterviewState.COMPLETED,
        message: "Interview session is already completed.",
        coverageState: session.coverageState,
      };
    }

    if (
      session.interviewState === InterviewState.CREATED ||
      session.interviewState === InterviewState.READY
    ) {
      throw new ApiError(400, "Interview session has not been started yet.");
    }

    if (
      session.interviewState === InterviewState.CANCELLED ||
      session.interviewState === InterviewState.EXPIRED
    ) {
      throw new ApiError(400, `Interview is no longer active (state: ${session.interviewState}).`);
    }

    // 2. Fetch InterviewPlan
    const plan = await InterviewPlan.findById(session.planId);
    if (!plan) {
      throw new ApiError(404, "Interview plan not found for session.");
    }

    // 3. Locate the most recent turn
    let lastTurn = await InterviewTurn.findOne({ sessionId: session._id }).sort({
      turnNumber: -1,
    });

    if (!lastTurn) {
      throw new ApiError(404, "No turns found for interview session.");
    }

    // 3b. Idempotency Guard: If the active question is pending an answer, return it without creating duplicate turn
    if (
      session.interviewState === InterviewState.IN_PROGRESS &&
      session.currentQuestion &&
      lastTurn &&
      !lastTurn.candidateAnswer
    ) {
      logger.info(
        `Session ${session.interviewId}: Active question (turn ${lastTurn.turnNumber}) awaiting answer. Returning existing question idempotently.`
      );
      return {
        sessionId: session.interviewId,
        nextAction: lastTurn.followUp ? InterviewAction.FOLLOW_UP : InterviewAction.ASK_QUESTION,
        interviewState: session.interviewState,
        currentQuestion: session.currentQuestion,
        timeRemaining: session.timeRemaining,
        topic: session.currentTopic,
        topicQuestionCount: session.topicQuestionCount,
      };
    }

    // 4. Ensure last turn is analyzed before deciding next action
    if (lastTurn.candidateAnswer && lastTurn.processingState !== "ANALYZED") {
      logger.info(
        `Auto-analyzing turn ${lastTurn.turnNumber} for session ${session.interviewId} before next action.`
      );
      await answerAnalysisService.analyzeTurnAnswer({
        sessionId: session.interviewId,
        user,
        turnId: lastTurn._id,
      });
      // Reload session and last turn to capture updated performance and analysis state
      const reloaded = await InterviewSession.findById(session._id);
      if (reloaded) {
        session.candidatePerformance = reloaded.candidatePerformance;
        session.coverageState = reloaded.coverageState;
        session.interviewState = reloaded.interviewState;
      }
      lastTurn = await InterviewTurn.findById(lastTurn._id);
    }

    // 5. Determine next action through Adaptive Engine (Backend Authority)
    const decision = adaptiveEngineService.determineNextAction(session, plan, lastTurn);

    logger.info(
      `AdaptiveEngine decided '${decision.action}' for session ${session.interviewId} (reason: ${decision.reason})`
    );

    // 6. Execute Determined Action
    if (decision.action === InterviewAction.COMPLETE_INTERVIEW) {
      session.interviewState = InterviewState.COMPLETED;
      session.endTime = new Date();
      session.currentQuestion = null;

      if (Array.isArray(session.coverageState)) {
        session.coverageState.forEach((c) => {
          if (c.status === "IN_PROGRESS") c.status = "EVALUATED";
        });
      }

      await session.save();

      // Eagerly compute+cache results now, so the details page and history
      // never hit a slow first-load lazy-compute path right after finishing.
      await interviewResultsService.getInterviewResults(session.interviewId, user);

      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.COMPLETE_INTERVIEW,
        interviewState: InterviewState.COMPLETED,
        message: decision.reason,
        totalQuestionsAsked: session.questionCount,
        coverageState: session.coverageState,
      };
    }

    if (decision.action === InterviewAction.FOLLOW_UP) {
      session.followUpCount = (session.followUpCount || 0) + 1;
      session.globalFollowUpCount = (session.globalFollowUpCount || 0) + 1;
      session.interviewState = InterviewState.IN_PROGRESS;

      const newQuestion = await questionService.generateFollowUpQuestion(
        session,
        plan,
        lastTurn
      );

      await session.save();

      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.FOLLOW_UP,
        interviewState: session.interviewState,
        currentQuestion: newQuestion,
        followUpCount: session.followUpCount,
        globalFollowUpCount: session.globalFollowUpCount,
        timeRemaining: session.timeRemaining,
        topic: session.currentTopic,
        questionCount: session.questionCount,
      };
    }

    if (decision.action === InterviewAction.SWITCH_TOPIC) {
      // Mark previous topic as evaluated
      if (Array.isArray(session.coverageState)) {
        const prevIndex = session.coverageState.findIndex(
          (c) => c.topic.toUpperCase() === (session.currentTopic || "").toUpperCase()
        );
        if (prevIndex >= 0) {
          session.coverageState[prevIndex].status = "EVALUATED";
        }
      }

      // Switch to next topic & reset topic-scoped counters
      session.currentTopic = decision.nextTopic;
      session.topicQuestionCount = 1;
      session.followUpCount = 0;
      if (session.candidatePerformance) {
        session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;
      }
      session.interviewState = InterviewState.IN_PROGRESS;

      const newQuestion = await questionService.generateNextQuestion(session, plan, {
        topic: decision.nextTopic,
        difficulty: decision.difficulty,
      });

      await session.save();

      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.SWITCH_TOPIC,
        switchedTopic: decision.nextTopic,
        interviewState: session.interviewState,
        currentQuestion: newQuestion,
        timeRemaining: session.timeRemaining,
        topic: session.currentTopic,
        topicQuestionCount: session.topicQuestionCount,
        questionCount: session.questionCount,
      };
    }

    // Default: ASK_QUESTION in current topic
    session.topicQuestionCount = (session.topicQuestionCount || 0) + 1;
    session.followUpCount = 0;
    session.interviewState = InterviewState.IN_PROGRESS;

    const newQuestion = await questionService.generateNextQuestion(session, plan, {
      topic: decision.topic,
      difficulty: decision.difficulty,
    });

    await session.save();

    return {
      sessionId: session.interviewId,
      nextAction: InterviewAction.ASK_QUESTION,
      interviewState: session.interviewState,
      currentQuestion: newQuestion,
      timeRemaining: session.timeRemaining,
      topic: session.currentTopic,
      topicQuestionCount: session.topicQuestionCount,
      questionCount: session.questionCount,
    };
  }

  /**
   * POST /ai-interview/:id/complete
   * Force-finishes an interview regardless of adaptive-engine state — used
   * both for a candidate-triggered "End Interview" and as the terminal step
   * a natural completion can also route through. Idempotent: calling this
   * on an already-terminal session just returns its (cached) results.
   */
  async completeInterview(sessionId, user) {
    const session = await this.getSessionById(sessionId, user);

    const TERMINAL_STATES = [
      InterviewState.COMPLETED,
      InterviewState.EVALUATED,
      InterviewState.CANCELLED,
      InterviewState.EXPIRED,
    ];

    if (!TERMINAL_STATES.includes(session.interviewState)) {
      const turn = await InterviewTurn.findOne({ sessionId: session._id }).sort({
        turnNumber: -1,
      });

      if (turn) {
        if (turn.candidateAnswer && turn.processingState !== "ANALYZED") {
          // Answered but never scored — analyze it fairly rather than discarding it.
          await answerAnalysisService.analyzeTurnAnswer({
            sessionId: session.interviewId,
            user,
            turnId: turn._id,
          });
        } else if (!turn.candidateAnswer) {
          // Never answered — record it as a skipped turn with zeroed scores
          // so the results computation needs no special-casing for it.
          turn.answerStatus = "SKIPPED";
          turn.relevanceScore = 0;
          turn.correctnessScore = 0;
          turn.completenessScore = 0;
          turn.confidence = 0;
          turn.feedbackSummary = "Question skipped — interview ended before this question was answered.";
          turn.processingState = "EVALUATED";
          turn.analysisTimestamp = new Date();
          await turn.save();
        }
      }

      // Reload in case analyzeTurnAnswer mutated session state underneath us.
      const reloaded = await InterviewSession.findById(session._id);

      if (Array.isArray(reloaded.coverageState)) {
        reloaded.coverageState.forEach((c) => {
          if (c.status === "IN_PROGRESS") c.status = "EVALUATED";
        });
      }
      reloaded.interviewState = InterviewState.COMPLETED;
      reloaded.endTime = reloaded.endTime || new Date();
      reloaded.currentQuestion = null;
      await reloaded.save();

      logger.info(`Interview force-completed: ${reloaded.interviewId} by user ${user._id}`);

      return interviewResultsService.getInterviewResults(reloaded.interviewId, user);
    }

    return interviewResultsService.getInterviewResults(session.interviewId, user);
  }
}

export const interviewSessionService = new InterviewSessionService();
export default interviewSessionService;
