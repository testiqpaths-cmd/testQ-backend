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
import { phaseService } from "./phase.service.js";
import { answerAnalysisService } from "./answer-analysis.service.js";
import { interviewResultsService } from "./interview-results.service.js";
import { questionPlannerService } from "./interview-question-planner.service.js";
import { followUpProbePlannerService } from "./follow-up-probe-planner.service.js";
import { assertCanViewSession } from "../utils/authorize.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

export class InterviewSessionService {
  // sessionId -> in-flight Promise. The room can reach startInterview /
  // submitAnswer / processNextAction through two transports (REST and the
  // Socket.io channel), and the socket client falls back to REST if an ack
  // is slow — without this, a slow AI call (question-gen + dedup retries
  // can take 30s+) lets both transports run the same mutation concurrently,
  // and the loser's session.save() dies with a Mongoose VersionError. A
  // second call for a session already in flight just awaits the first.
  #inflight = new Map();

  async #withSessionLock(sessionId, fn) {
    const key = String(sessionId);
    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const promise = Promise.resolve()
      .then(fn)
      .finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }

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
    const interviewTypes = (Array.isArray(payload.interviewTypes) && payload.interviewTypes.length
      ? payload.interviewTypes
      : payload.interviewType
      ? [payload.interviewType]
      : ["technical"]).map((t) => String(t || "").toLowerCase().trim()).filter(Boolean);

    // Determine scoped topics from selected tech, role, and interviewTypes
    let topics = resumeTopicService.selectInterviewTopics({
      role,
      candidateSkills: techStack,
      duration,
      experienceLevel,
      interviewTypes,
    });

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

    // 1b. Group the topics into ordered phases (INTRO -> ... -> SCENARIO).
    // topicOrder follows phase order so the flat engine walks phases in
    // sequence; an empty phasePlan leaves the engine's behaviour unchanged.
    const phasePlan = phaseService.build(topics, {
      globalQuestionLimit: plan.globalQuestionLimit,
    });
    const orderedTopics = phasePlan.length
      ? phasePlan.flatMap((p) => p.topics)
      : topics.map((t) => String(t).toUpperCase());

    // 2. Initialize Topic Coverage State
    const coverageState = orderedTopics.map((topic) => ({
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
      currentTopic: orderedTopics[0],
      currentQuestion: null,
      questionCount: 0,
      topicQuestionCount: 0,
      followUpCount: 0,
      globalFollowUpCount: 0,
      coverageState,
      phasePlan,
      currentPhase: phasePlan[0]?.phase || null,
      candidatePerformance: {
        baselineEstablished: false,
        baselineScore: 0,
        streakCorrect: 0,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
        runningAccuracy: 0,
      },
      interviewState: InterviewState.READY,
      allowedTopics: orderedTopics,
      topicOrder: orderedTopics,
      planId: plan._id,
      resumeData: null,
    });

    await session.save();

    // Link session ID on plan
    plan.sessionId = session._id;
    await plan.save();

    logger.info(`InterviewSession created: ${interviewId} for user ${userId}`);

    // Sprint 2: Non-blocking background question pre-buffering
    questionPlannerService.replenishPoolInBackground(session._id);

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
    const interviewTypes = (Array.isArray(payload.interviewTypes) && payload.interviewTypes.length
      ? payload.interviewTypes
      : payload.interviewType
      ? [payload.interviewType]
      : ["technical"]).map((t) => String(t || "").toLowerCase().trim()).filter(Boolean);

    let resumeData = null;
    let scopedTopics = [];

    if (file) {
      // Process uploaded resume file
      const processed = await resumeService.processResume(file, {
        role,
        duration,
        experienceLevel,
        interviewTypes,
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
        interviewTypes,
      });
    } else if (payload.resumeData) {
      // Direct structured resume data provided
      resumeData = payload.resumeData;
      scopedTopics = resumeTopicService.selectInterviewTopics({
        role,
        candidateSkills: payload.resumeData.skills || [],
        duration,
        experienceLevel,
        interviewTypes,
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

    // 1b. Group the scoped topics into ordered phases.
    const phasePlan = phaseService.build(scopedTopics, {
      globalQuestionLimit: plan.globalQuestionLimit,
    });
    const orderedTopics = phasePlan.length
      ? phasePlan.flatMap((p) => p.topics)
      : scopedTopics.map((t) => String(t).toUpperCase());

    // 2. Initialize Topic Coverage
    const coverageState = orderedTopics.map((topic) => ({
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
      interviewTypes,
      duration,
      difficulty,
      timeRemaining: duration * 60,
      currentTopic: orderedTopics[0],
      currentQuestion: null,
      questionCount: 0,
      topicQuestionCount: 0,
      followUpCount: 0,
      globalFollowUpCount: 0,
      coverageState,
      phasePlan,
      currentPhase: phasePlan[0]?.phase || null,
      candidatePerformance: {
        baselineEstablished: false,
        baselineScore: 0,
        streakCorrect: 0,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
        runningAccuracy: 0,
      },
      interviewState: InterviewState.READY,
      allowedTopics: orderedTopics,
      topicOrder: orderedTopics,
      planId: plan._id,
      resumeData,
    });

    await session.save();

    plan.sessionId = session._id;
    await plan.save();

    logger.info(`Resume InterviewSession created: ${interviewId} for user ${userId}`);

    // Sprint 2: Non-blocking background question pre-buffering
    questionPlannerService.replenishPoolInBackground(session._id);

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

    // Owner, IQPATH_ADMIN, or an ORGANIZATION user monitoring their own student.
    await assertCanViewSession(user, session);

    return session;
  }

  /**
   * List interview sessions for a specific user (paginated)
   */
  async getUserSessions(userId, { page = 1, limit = 100 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
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
    return this.#withSessionLock(sessionId, () => this.#startInterviewImpl(sessionId, user));
  }

  async #startInterviewImpl(sessionId, user) {
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
        interviewTypes: session.interviewTypes || ["technical"],
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

    // Initialize current topic for introduction
    session.currentTopic = "INTRODUCTION";

    // Retrieve internal plan
    const plan = await InterviewPlan.findById(session.planId);
    if (!plan) {
      throw new ApiError(404, "Interview plan not found for this session.");
    }

    // Generate first question (delegates to QuestionService with backend limits & fallback)
    const firstQuestion = await questionService.generateFirstQuestion(session, plan);

    // Count Q1 against its phase.
    phaseService.recordQuestion(session, session.currentTopic);

    await session.save();

    logger.info(`Interview started: ${session.interviewId} by user ${user._id}`);

    // Sprint 2: Ensure background replenishment continues while candidate answers Q1
    questionPlannerService.replenishPoolInBackground(session._id);

    // Sprint 6: Prepare targeted follow-up probes for Q1 in background while candidate speaks
    followUpProbePlannerService.prepareProbesForQuestion(session, firstQuestion);

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
      interviewTypes: session.interviewTypes || ["technical"],
      phase: session.currentPhase,
      phaseProgress: phaseService.progress(session),
    };
  }

  /**
   * POST /ai-interview/:id/answer
   * Submits and persists candidate answer for current turn.
   * Updates existing InterviewTurn, enforces duplicate protection,
   * transitions state to WAITING_FOR_NEXT_QUESTION.
   */
  async submitAnswer(sessionId, user, payload) {
    return this.#withSessionLock(sessionId, () => this.#submitAnswerImpl(sessionId, user, payload));
  }

  async #submitAnswerImpl(sessionId, user, payload) {
    const session = await this.getSessionById(sessionId, user);

    // 1. State Gate: Accept answers when IN_PROGRESS or PROCESSING_ANSWER.
    // If the session is already in WAITING_FOR_NEXT_QUESTION (e.g. from an earlier socket call,
    // a network retry, or a recovered turn awaiting /next), return idempotent confirmation so
    // the client proceeds directly to fetch the next question without a 400 rejection.
    if (
      session.interviewState !== InterviewState.IN_PROGRESS &&
      session.interviewState !== InterviewState.PROCESSING_ANSWER
    ) {
      if (session.interviewState === InterviewState.WAITING_FOR_NEXT_QUESTION) {
        let turn = null;
        const targetQId = payload.questionId || payload.turnId || session.currentQuestion?.id || session.currentQuestion?.questionId;
        if (targetQId) {
          turn = await InterviewTurn.findById(targetQId);
        }
        if (!turn) {
          turn = await InterviewTurn.findOne({ sessionId: session._id }).sort({ turnNumber: -1 });
        }
        if (turn) {
          const answerText = (payload.answer || payload.transcript || "").trim();
          if (answerText && turn.processingState !== "ANALYZED" && turn.processingState !== "EVALUATED") {
            turn.candidateAnswer = answerText;
            await turn.save();
          }
          logger.info(
            `Session ${session.interviewId} is already WAITING_FOR_NEXT_QUESTION. Returning idempotent answer confirmation for turn ${turn.turnNumber}.`
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
      }

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
    const timedOut = payload.timedOut === true;
    if (!answerText && !timedOut) {
      throw new ApiError(400, "Candidate answer or transcript cannot be empty.");
    }
    // The response timer fired: an empty answer means the candidate said
    // nothing (scored as SKIPPED); a non-empty one is a partial answer
    // cut short by a long pause, judged normally.
    const endedReason = timedOut
      ? answerText
        ? "timeout_pause"
        : "timeout_no_response"
      : "answered";

    // 4. Find the existing InterviewTurn created in Phase 2
    let turn = null;
    const targetQId = payload.questionId || payload.turnId;
    if (targetQId) {
      turn = await InterviewTurn.findById(targetQId);
    }

    if (!turn && (session.currentQuestion?.id || session.currentQuestion?.questionId)) {
      const qId = session.currentQuestion.id || session.currentQuestion.questionId;
      turn = await InterviewTurn.findById(qId);
    }

    if (!turn) {
      turn = await InterviewTurn.findOne({ sessionId: session._id }).sort({ turnNumber: -1 });
    }

    if (!turn) {
      throw new ApiError(404, "Active interview turn not found for current question.");
    }

    // 5. Idempotency & Duplicate Submission Protection
    const alreadyRecorded =
      Boolean(turn.candidateAnswer && turn.candidateAnswer.trim()) ||
      turn.endedReason === "timeout_no_response" ||
      ["SUBMITTED", "ANALYZED", "EVALUATED"].includes(turn.processingState);

    if (alreadyRecorded) {
      const sameText = (turn.candidateAnswer || "").trim() === answerText;
      if (sameText || (timedOut && turn.endedReason?.startsWith("timeout"))) {
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

    const tSaveStart = performance.now();
    // 7. Update the existing InterviewTurn (Do NOT create a second turn)
    turn.candidateAnswer = answerText;
    turn.answerTimestamp = now;
    turn.timeTakenSeconds = timeTaken || null;
    turn.audioReference = payload.audioReference || null;
    turn.endedReason = endedReason;
    turn.processingState = "SUBMITTED";

    // 8. Deduct elapsed time and advance state to WAITING_FOR_NEXT_QUESTION
    if (timeTaken && session.timeRemaining > 0) {
      session.timeRemaining = Math.max(0, session.timeRemaining - timeTaken);
    }
    session.interviewState = InterviewState.WAITING_FOR_NEXT_QUESTION;

    const answerSaveMs = Math.round(performance.now() - tSaveStart);
    const nowWall = Date.now();
    turn.latencyMetrics = {
      ...(turn.latencyMetrics || {}),
      answerSaveMs,
      t0_candidateSubmit: payload?._t0 || payload?.clientSubmitTimestamp || null,
      t1_requestReceived: payload?._t1 || (nowWall - answerSaveMs),
      t2_answerPersisted: nowWall,
    };

    await turn.save();
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
      latencyMetrics: turn.latencyMetrics,
    };
  }

  /**
   * Fast Interaction Pipeline:
   * Atomically submits the active answer, analyzes it, executes adaptive decision,
   * claims the next question from PREPARED_POOL, and returns the response in a
   * single interaction roundtrip without intermediate client-server hops.
   *
   * @param {string} sessionId
   * @param {Object} user
   * @param {Object} payload - Answer submission payload
   * @returns {Promise<Object>} Next question result payload
   */
  async submitAnswerAndNext(sessionId, user, payload = {}) {
    const t0 = payload?.clientSubmitTimestamp || null;
    const t1 = Date.now();
    return this.#withSessionLock(sessionId, async () => {
      await this.#submitAnswerImpl(sessionId, user, { ...payload, _t0: t0, _t1: t1 });
      const t2 = Date.now();
      return this.#processNextActionImpl(sessionId, user, { _t0: t0, _t1: t1, _t2: t2 });
    });
  }

  /**
   * POST /ai-interview/:id/next & POST /ai-interview/sessions/:id/next
   * Orchestrates the next interview step via AdaptiveEngine:
   * Analyzes active turn (if not yet analyzed), determines next action
   * (ASK_QUESTION, FOLLOW_UP, SWITCH_TOPIC, COMPLETE_INTERVIEW), executes it,
   * updates state/counters, and returns structured result.
   */
  async processNextAction(sessionId, user) {
    return this.#withSessionLock(sessionId, () => this.#processNextActionImpl(sessionId, user));
  }

  async #processNextActionImpl(sessionId, user, attributionCtx = {}) {
    const totalTurnStart = performance.now();
    const tTurnStartWall = Date.now();
    let answerAnalysisMs = 0;
    let adaptiveDecisionMs = 0;
    let dbMs = 0;
    let t3Wall = null;
    let t4Wall = null;
    let t5Wall = null;
    let t6Wall = null;

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
      !lastTurn.candidateAnswer &&
      lastTurn.endedReason !== "timeout_no_response"
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

    // 4. Ensure last turn is analyzed before deciding next action. A
    // timed-out no-response turn is also routed through analysis so it
    // gets a SKIPPED status + zeroed scores + coverage/perf bookkeeping.
    const needsAnalysis =
      (Boolean(lastTurn.candidateAnswer && lastTurn.candidateAnswer.trim()) ||
        lastTurn.endedReason === "timeout_no_response") &&
      lastTurn.processingState !== "ANALYZED";

    if (needsAnalysis) {
      logger.info(
        `Auto-analyzing turn ${lastTurn.turnNumber} for session ${session.interviewId} before next action.`
      );
      t3Wall = Date.now();
      const tAnalysisStart = performance.now();
      const analysisRes = await answerAnalysisService.analyzeTurnAnswer({
        sessionId: session.interviewId,
        user,
        turnId: lastTurn._id,
      });
      t4Wall = Date.now();
      answerAnalysisMs = analysisRes?.latencyMetrics?.answerAnalysisMs || Math.round(performance.now() - tAnalysisStart);
      // Reload session and last turn to capture updated performance and analysis state
      const tReloadStart = performance.now();
      const reloaded = await InterviewSession.findById(session._id);
      if (reloaded) {
        session.candidatePerformance = reloaded.candidatePerformance;
        session.coverageState = reloaded.coverageState;
        session.interviewState = reloaded.interviewState;
      }
      lastTurn = await InterviewTurn.findById(lastTurn._id);
      const stateReloadMs = Math.round(performance.now() - tReloadStart);
      attributionCtx._stateReloadMs = stateReloadMs;
    } else if (lastTurn?.latencyMetrics?.answerAnalysisMs) {
      answerAnalysisMs = lastTurn.latencyMetrics.answerAnalysisMs;
      t3Wall = lastTurn?.latencyMetrics?.t3_analysisStarted || tTurnStartWall;
      t4Wall = lastTurn?.latencyMetrics?.t4_analysisCompleted || (tTurnStartWall + answerAnalysisMs);
    }

    // 5. Determine next action through Adaptive Engine (Backend Authority)
    const tDecisionStart = performance.now();
    const decision = adaptiveEngineService.determineNextAction(session, plan, lastTurn);
    adaptiveDecisionMs = Math.round(performance.now() - tDecisionStart);
    t5Wall = Date.now();

    logger.info(
      `AdaptiveEngine decided '${decision.action}' for session ${session.interviewId} (reason: ${decision.reason})`
    );

    const finalizeTurnMetrics = async (newQuestion = null) => {
      const tDbStart = performance.now();
      await session.save();
      dbMs = Math.round(performance.now() - tDbStart);
      const t7Wall = Date.now();

      const turnTotalLatencyMs = Math.round(performance.now() - totalTurnStart);
      const candidateVisibleLatencyMs = lastTurn?.answerTimestamp
        ? Math.max(turnTotalLatencyMs, Date.now() - new Date(lastTurn.answerTimestamp).getTime())
        : turnTotalLatencyMs;

      const t0 = attributionCtx._t0 || lastTurn?.latencyMetrics?.t0_candidateSubmit || null;
      const t1 = attributionCtx._t1 || lastTurn?.latencyMetrics?.t1_requestReceived || (tTurnStartWall - (lastTurn?.latencyMetrics?.answerSaveMs || 0));
      const t2 = attributionCtx._t2 || lastTurn?.latencyMetrics?.t2_answerPersisted || (t3Wall || tTurnStartWall);
      const t3 = t3Wall || tTurnStartWall;
      const t4 = t4Wall || (t3 + answerAnalysisMs);
      const stateReloadMs = attributionCtx._stateReloadMs || 0;
      const t5 = t5Wall || (t4 + stateReloadMs + adaptiveDecisionMs);
      const t6 = t6Wall || t5;
      const t7 = t7Wall;

      const attribution = {
        timestamps: {
          t0_candidateSubmit: t0,
          t1_requestReceived: t1,
          t2_answerPersisted: t2,
          t3_analysisStarted: t3,
          t4_analysisCompleted: t4,
          t5_decisionCompleted: t5,
          t6_questionAcquired: t6,
          t7_responseSent: t7,
        },
        durations: {
          uplinkMs: t0 ? Math.max(0, t1 - t0) : null,
          answerSaveMs: t2 ? Math.max(0, t2 - t1) : (lastTurn?.latencyMetrics?.answerSaveMs || 0),
          analysisWaitMs: t2 ? Math.max(0, t3 - t2) : 0,
          answerAnalysisMs: Math.max(0, t4 - t3),
          stateReloadMs,
          adaptiveDecisionMs,
          questionAcquisitionMs: Math.max(0, t6 - t5),
          responseFinalizeMs: Math.max(0, t7 - t6),
          backendTotalMs: Math.max(0, t7 - t1),
        },
        questionSource: newQuestion?.questionSource || (decision.action === InterviewAction.FOLLOW_UP ? "dynamic_followup" : (decision.action === InterviewAction.COMPLETE_INTERVIEW ? "none" : "prepared_pool")),
      };

      const metrics = {
        turnTotalLatencyMs,
        answerSaveMs: lastTurn?.latencyMetrics?.answerSaveMs || null,
        answerAnalysisMs,
        adaptiveDecisionMs,
        questionSelectionMs: newQuestion?.latencyMetrics?.questionSelectionMs || 0,
        questionGenerationMs: newQuestion?.latencyMetrics?.questionGenerationMs || 0,
        embeddingMs: newQuestion?.latencyMetrics?.embeddingMs || 0,
        dbMs,
        candidateVisibleLatencyMs,
        attribution,
      };

      if (lastTurn && lastTurn.processingState === "ANALYZED") {
        lastTurn.latencyMetrics = {
          ...(lastTurn.latencyMetrics || {}),
          ...metrics,
        };
        await lastTurn.save().catch(() => {});
      }

      return metrics;
    };

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

      t6Wall = Date.now();
      const turnMetrics = await finalizeTurnMetrics(null);

      // Eagerly compute+cache results now, so the details page and history
      // never hit a slow first-load lazy-compute path right after finishing.
      try {
        await interviewResultsService.getInterviewResults(session.interviewId, user);
      } catch (err) {
        logger.warn(`Eager results calculation non-fatal error: ${err.message}`);
      }

      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.COMPLETE_INTERVIEW,
        interviewState: InterviewState.COMPLETED,
        message: decision.reason,
        totalQuestionsAsked: session.questionCount,
        coverageState: session.coverageState,
        decisionAudit: decision.decisionAudit || null,
        latencyMetrics: turnMetrics,
        questionSource: "none",
      };
    }

    const activeQuestionId = lastTurn?._id?.toString() || lastTurn?.id || "q-active";

    if (decision.action === InterviewAction.FOLLOW_UP) {
      session.followUpCount = (session.followUpCount || 0) + 1;
      session.topicFollowUpCount = (session.topicFollowUpCount || 0) + 1;
      session.globalFollowUpCount = (session.globalFollowUpCount || 0) + 1;
      session.interviewState = InterviewState.IN_PROGRESS;

      // Sprint 6: Attempt claim on prefetched probe for parent question
      let newQuestion = null;
      const claimedProbe = await followUpProbePlannerService.claimMatchingProbe(
        session,
        activeQuestionId,
        decision,
        lastTurn
      );

      if (claimedProbe) {
        newQuestion = await questionService.createTurnFromPrefetchedProbe(
          session,
          lastTurn,
          claimedProbe,
          decision
        );
      } else {
        newQuestion = await questionService.generateFollowUpQuestion(
          session,
          plan,
          lastTurn,
          {
            difficulty: decision.difficulty,
            followUpType: decision.followUpType || lastTurn?.followUpType,
            followUpReason: decision.followUpReason || lastTurn?.followUpReason || null,
            missingConcept: decision.missingConcept || lastTurn?.missingConcept || null,
            decisionAudit: decision.decisionAudit || null,
          }
        );
      }
      t6Wall = Date.now();
      followUpProbePlannerService.prepareProbesForQuestion(session, newQuestion);

      const turnMetrics = await finalizeTurnMetrics(newQuestion);

      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.FOLLOW_UP,
        interviewState: session.interviewState,
        currentQuestion: newQuestion,
        isFollowUp: true,
        followUpCount: session.followUpCount,
        topicFollowUpCount: session.topicFollowUpCount,
        globalFollowUpCount: session.globalFollowUpCount,
        followUpReason: decision.followUpReason || lastTurn?.followUpReason || null,
        missingConcept: decision.missingConcept || lastTurn?.missingConcept || null,
        timeRemaining: session.timeRemaining,
        topic: session.currentTopic,
        questionCount: session.questionCount,
        decisionAudit: decision.decisionAudit || null,
        latencyMetrics: turnMetrics,
        questionSource: newQuestion.questionSource || "ai_generated",
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
          session.coverageState[prevIndex].shouldContinue = false;
        }
      }

      // Switch to next topic & reset topic-scoped counters
      session.currentTopic = decision.nextTopic;
      session.topicQuestionCount = 1;
      session.followUpCount = 0;
      session.topicFollowUpCount = 0;
      // Roll the phase forward if this topic belongs to a later phase.
      phaseService.enterPhaseForTopic(session, decision.nextTopic);
      if (session.candidatePerformance) {
        session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;
      }
      session.interviewState = InterviewState.IN_PROGRESS;

      const newQuestion = await questionService.generateNextQuestion(session, plan, {
        topic: decision.nextTopic,
        difficulty: decision.difficulty,
        decisionAudit: decision.decisionAudit || null,
      });
      t6Wall = Date.now();

      phaseService.recordQuestion(session, session.currentTopic);
      const turnMetrics = await finalizeTurnMetrics(newQuestion);

      // Sprint 6: Clean up old parent probes and prefetch probes for the new question
      followUpProbePlannerService.discardProbesForQuestion(session._id, activeQuestionId);
      followUpProbePlannerService.prepareProbesForQuestion(session, newQuestion);

      return {
        sessionId: session.interviewId,
        nextAction: InterviewAction.SWITCH_TOPIC,
        switchedTopic: decision.nextTopic,
        interviewState: session.interviewState,
        currentQuestion: newQuestion,
        isFollowUp: false,
        timeRemaining: session.timeRemaining,
        topic: session.currentTopic,
        topicQuestionCount: session.topicQuestionCount,
        questionCount: session.questionCount,
        phase: session.currentPhase,
        phaseProgress: phaseService.progress(session),
        decisionAudit: decision.decisionAudit || null,
        latencyMetrics: turnMetrics,
        questionSource: newQuestion.questionSource || "ai_generated",
      };
    }

    // Default: ASK_QUESTION in current topic
    session.topicQuestionCount = (session.topicQuestionCount || 0) + 1;
    session.followUpCount = 0;
    session.interviewState = InterviewState.IN_PROGRESS;

    const newQuestion = await questionService.generateNextQuestion(session, plan, {
      topic: decision.topic,
      difficulty: decision.difficulty,
      decisionAudit: decision.decisionAudit || null,
    });
    t6Wall = Date.now();

    phaseService.recordQuestion(session, session.currentTopic);
    const turnMetrics = await finalizeTurnMetrics(newQuestion);

    // Sprint 6: Clean up old parent probes and prefetch probes for the new question
    followUpProbePlannerService.discardProbesForQuestion(session._id, activeQuestionId);
    followUpProbePlannerService.prepareProbesForQuestion(session, newQuestion);

    return {
      sessionId: session.interviewId,
      nextAction: InterviewAction.ASK_QUESTION,
      interviewState: session.interviewState,
      currentQuestion: newQuestion,
      isFollowUp: false,
      timeRemaining: session.timeRemaining,
      topic: session.currentTopic,
      topicQuestionCount: session.topicQuestionCount,
      questionCount: session.questionCount,
      phase: session.currentPhase,
      phaseProgress: phaseService.progress(session),
      decisionAudit: decision.decisionAudit || null,
      latencyMetrics: turnMetrics,
      questionSource: newQuestion.questionSource || "ai_generated",
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
    return this.#withSessionLock(sessionId, () => this.#completeInterviewImpl(sessionId, user));
  }

  async #completeInterviewImpl(sessionId, user) {
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
