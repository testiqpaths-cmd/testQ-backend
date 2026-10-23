import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { interviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";
import { InterviewPlan } from "../src/ai-interview/schemas/interview-plan.schema.js";
import { interviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { answerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { adaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { questionService } from "../src/ai-interview/services/question.service.js";
import { questionPlannerService } from "../src/ai-interview/services/interview-question-planner.service.js";
import { followUpProbePlannerService } from "../src/ai-interview/services/follow-up-probe-planner.service.js";
import { ApiError } from "../src/common/exceptions/ApiError.js";

test("TC-175: AI Interview Session Lifecycle & Persistence Verification Suite", async (t) => {
  const makeMongooseQuery = (doc) => ({
    populate: () => makeMongooseQuery(doc),
    sort: () => makeMongooseQuery(doc),
    select: () => makeMongooseQuery(doc),
    lean: () => makeMongooseQuery(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
    catch: (reject) => Promise.resolve(doc).catch(reject),
  });

  // ==========================================================================
  // 1. Session Creation -> READY state
  // ==========================================================================
  await t.test("Requirement 1: Created session initializes and persists in READY state", async () => {
    assert.equal(InterviewState.READY, "READY");
    assert.equal(InterviewState.IN_PROGRESS, "IN_PROGRESS");
    assert.equal(InterviewState.COMPLETED, "COMPLETED");

    const sessionDoc = new InterviewSession({
      interviewId: "int-test-ready",
      userId: new mongoose.Types.ObjectId(),
      interviewState: InterviewState.READY,
      duration: 30,
    });

    assert.equal(sessionDoc.interviewState, InterviewState.READY);
  });

  // ==========================================================================
  // 2. Start Interview -> IN_PROGRESS persisted
  // ==========================================================================
  await t.test("Requirement 2: startInterview transitions session from READY to IN_PROGRESS and persists", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };
    let savedState = null;

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.READY,
      duration: 30,
      planId: new mongoose.Types.ObjectId(),
      save: async function () {
        savedState = this.interviewState;
        return this;
      },
    };

    const mockPlan = {
      _id: mockSession.planId,
      globalQuestionLimit: 10,
    };

    const origFindOne = InterviewSession.findOne;
    const origPlanFindById = InterviewPlan.findById;
    const origGenFirstQ = questionService.generateFirstQuestion;
    const origReplenish = questionPlannerService.replenishPoolInBackground;
    const origPrepareProbes = followUpProbePlannerService.prepareProbesForQuestion;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewPlan.findById = () => makeMongooseQuery(mockPlan);
      questionService.generateFirstQuestion = async () => ({
        id: "q-1",
        questionText: "Tell me about yourself.",
        topic: "INTRODUCTION",
      });
      questionPlannerService.replenishPoolInBackground = () => {};
      followUpProbePlannerService.prepareProbesForQuestion = () => {};

      const res = await interviewSessionService.startInterview(mockSession.interviewId, mockUser);

      assert.equal(mockSession.interviewState, InterviewState.IN_PROGRESS);
      assert.equal(savedState, InterviewState.IN_PROGRESS, "IN_PROGRESS must be persisted to database");
      assert.equal(res.status, "IN_PROGRESS");
      assert.equal(res.interviewState, "IN_PROGRESS");
      assert.ok(mockSession.startTime instanceof Date);
      assert.ok(mockSession.endTime instanceof Date);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewPlan.findById = origPlanFindById;
      questionService.generateFirstQuestion = origGenFirstQ;
      questionPlannerService.replenishPoolInBackground = origReplenish;
      followUpProbePlannerService.prepareProbesForQuestion = origPrepareProbes;
    }
  });

  // ==========================================================================
  // 3. Submit Answer -> Answer Processing & WAITING_FOR_NEXT_QUESTION
  // ==========================================================================
  await t.test("Requirement 3: submitAnswer saves answer and transitions to WAITING_FOR_NEXT_QUESTION", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };
    const turnId = new mongoose.Types.ObjectId();
    let sessionSaved = false;
    let turnSaved = false;

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      currentQuestion: { id: turnId.toString(), questionText: "What is JS?" },
      duration: 30,
      timeRemaining: 1800,
      endTime: new Date(Date.now() + 1800000),
      save: async function () {
        sessionSaved = true;
        return this;
      },
    };

    const mockTurn = {
      _id: turnId,
      sessionId: testSessionId,
      turnNumber: 1,
      candidateAnswer: null,
      questionTimestamp: new Date(Date.now() - 15000),
      processingState: "QUESTION_GENERATED",
      save: async function () {
        turnSaved = true;
        return this;
      },
    };

    const origFindOne = InterviewSession.findOne;
    const origTurnFindOne = InterviewTurn.findOne;
    const origTurnFindById = InterviewTurn.findById;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(mockTurn);
      InterviewTurn.findById = () => makeMongooseQuery(mockTurn);

      const res = await interviewSessionService.submitAnswer(mockSession.interviewId, mockUser, {
        questionId: turnId.toString(),
        answer: "JavaScript is a single-threaded, non-blocking asynchronous language.",
        timeTakenSeconds: 15,
      });

      assert.equal(sessionSaved, true);
      assert.equal(turnSaved, true);
      assert.equal(mockTurn.candidateAnswer, "JavaScript is a single-threaded, non-blocking asynchronous language.");
      assert.equal(mockTurn.processingState, "SUBMITTED");
      assert.equal(mockSession.interviewState, InterviewState.WAITING_FOR_NEXT_QUESTION);
      assert.equal(res.answerSaved, true);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewTurn.findOne = origTurnFindOne;
      InterviewTurn.findById = origTurnFindById;
    }
  });

  // ==========================================================================
  // 4. Adaptive Completion -> COMPLETED persisted
  // ==========================================================================
  await t.test("Requirement 4: Adaptive COMPLETE_INTERVIEW immediately persists COMPLETED and eager results", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };
    let persistedState = null;
    let resultsCalled = false;

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.WAITING_FOR_NEXT_QUESTION,
      duration: 30,
      timeRemaining: 10,
      endTime: new Date(Date.now() - 5000), // Wall clock expired
      planId: new mongoose.Types.ObjectId(),
      coverageState: [{ topic: "JAVASCRIPT", status: "IN_PROGRESS" }],
      save: async function () {
        persistedState = this.interviewState;
        return this;
      },
    };

    const mockPlan = {
      _id: mockSession.planId,
      globalQuestionLimit: 5,
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 5,
      candidateAnswer: "Closures capture lexical scope.",
      processingState: "ANALYZED",
      answerStatus: AnswerStatus.ACCURATE,
      latencyMetrics: {},
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origTurnFindById = InterviewTurn.findById;
    const origPlanFindById = InterviewPlan.findById;
    const origDetermineAction = adaptiveEngineService.determineNextAction;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(mockTurn);
      InterviewTurn.findById = () => makeMongooseQuery(mockTurn);
      InterviewPlan.findById = () => makeMongooseQuery(mockPlan);

      adaptiveEngineService.determineNextAction = () => ({
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: "Global question limit reached.",
        decisionAudit: { trigger: "LIMIT_REACHED" },
      });

      interviewResultsService.getInterviewResults = async (sessionId) => {
        resultsCalled = true;
        // Verify session in DB is already COMPLETED
        assert.equal(mockSession.interviewState, InterviewState.COMPLETED);
        return { score: 85, status: "COMPLETED" };
      };

      const result = await interviewSessionService.processNextAction(mockSession.interviewId, mockUser);

      assert.equal(result.nextAction, InterviewAction.COMPLETE_INTERVIEW);
      assert.equal(result.interviewState, InterviewState.COMPLETED);
      assert.equal(persistedState, InterviewState.COMPLETED, "session.save() must persist COMPLETED");
      assert.equal(mockSession.timeRemaining, 0);
      assert.equal(mockSession.currentQuestion, null);
      assert.equal(mockSession.coverageState[0].status, "EVALUATED");
      assert.equal(resultsCalled, true, "Eager results calculation must be invoked");
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      InterviewTurn.findById = origTurnFindById;
      InterviewPlan.findById = origPlanFindById;
      adaptiveEngineService.determineNextAction = origDetermineAction;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 5. Manual completion from active session -> COMPLETED
  // ==========================================================================
  await t.test("Requirement 5: Manual completion from active session (IN_PROGRESS) transitions to COMPLETED", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };
    let savedState = null;

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 900,
      coverageState: [{ topic: "REACT", status: "IN_PROGRESS" }],
      save: async function () {
        savedState = this.interviewState;
        return this;
      },
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 2,
      candidateAnswer: "Hooks enable state in functional components.",
      processingState: "SUBMITTED",
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origAnalyze = answerAnalysisService.analyzeTurnAnswer;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(mockTurn);

      answerAnalysisService.analyzeTurnAnswer = async () => {
        mockTurn.processingState = "ANALYZED";
        return { success: true };
      };

      interviewResultsService.getInterviewResults = async () => ({
        score: 78,
        status: "COMPLETED",
      });

      const res = await interviewSessionService.completeInterview(mockSession.interviewId, mockUser);

      assert.equal(mockSession.interviewState, InterviewState.COMPLETED);
      assert.equal(savedState, InterviewState.COMPLETED);
      assert.equal(mockSession.coverageState[0].status, "EVALUATED");
      assert.equal(res.status, "COMPLETED");
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      answerAnalysisService.analyzeTurnAnswer = origAnalyze;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 6. Timer completion -> COMPLETED
  // ==========================================================================
  await t.test("Requirement 6: Timer expiration completion zeroes timeRemaining and sets COMPLETED", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const expiredSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 0,
      endTime: new Date(Date.now() - 1000),
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(expiredSession);
      InterviewSession.findById = () => makeMongooseQuery(expiredSession);
      InterviewTurn.findOne = () => makeMongooseQuery(null);

      interviewResultsService.getInterviewResults = async () => ({ score: 70, status: "COMPLETED" });

      const res = await interviewSessionService.completeInterview(expiredSession.interviewId, mockUser);
      assert.equal(expiredSession.interviewState, InterviewState.COMPLETED);
      assert.equal(expiredSession.timeRemaining, 0);
      assert.equal(res.status, "COMPLETED");
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 7. Proctoring termination -> COMPLETED
  // ==========================================================================
  await t.test("Requirement 7: Proctoring auto-termination from active session safely completes", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const activeSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 600,
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(activeSession);
      InterviewSession.findById = () => makeMongooseQuery(activeSession);
      InterviewTurn.findOne = () => makeMongooseQuery(null);

      interviewResultsService.getInterviewResults = async () => ({ score: 50, status: "COMPLETED" });

      const res = await interviewSessionService.completeInterview(activeSession.interviewId, mockUser);
      assert.equal(activeSession.interviewState, InterviewState.COMPLETED);
      assert.equal(res.status, "COMPLETED");
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 8. Completion request before start (READY or CREATED) -> REJECTED (HTTP 400)
  // ==========================================================================
  await t.test("Requirement 8: Completion request before start (READY / CREATED) is rejected with 400 and NOT completed", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };
    let saveAttempted = false;

    const unstartedSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.READY,
      duration: 30,
      timeRemaining: 1800,
      save: async function () {
        saveAttempted = true;
        return this;
      },
    };

    const origFindOne = InterviewSession.findOne;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(unstartedSession);

      let thrownError = null;
      try {
        await interviewSessionService.completeInterview(unstartedSession.interviewId, mockUser);
      } catch (err) {
        thrownError = err;
      }

      assert.ok(thrownError instanceof ApiError, "Must throw ApiError");
      assert.equal(thrownError.statusCode, 400, "Must return HTTP 400");
      assert.match(thrownError.message, /session has not been started/i);
      assert.equal(unstartedSession.interviewState, InterviewState.READY, "Session state must remain READY");
      assert.equal(saveAttempted, false, "save() must not be called on unstarted session");
    } finally {
      InterviewSession.findOne = origFindOne;
    }
  });

  await t.test("Requirement 8b: Completion request on CREATED session is also rejected with 400", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const createdSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.CREATED,
      duration: 30,
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(createdSession);

      await assert.rejects(
        () => interviewSessionService.completeInterview(createdSession.interviewId, mockUser),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /session has not been started/i);
          return true;
        }
      );
      assert.equal(createdSession.interviewState, InterviewState.CREATED);
    } finally {
      InterviewSession.findOne = origFindOne;
    }
  });

  // ==========================================================================
  // 9. Duplicate completion request -> Safe and idempotent
  // ==========================================================================
  await t.test("Requirement 9: Duplicate completion on already COMPLETED session is idempotent", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const completedSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.COMPLETED,
      duration: 30,
      timeRemaining: 0,
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(completedSession);
      interviewResultsService.getInterviewResults = async () => ({ score: 92, status: "COMPLETED" });

      const res1 = await interviewSessionService.completeInterview(completedSession.interviewId, mockUser);
      const res2 = await interviewSessionService.completeInterview(completedSession.interviewId, mockUser);

      assert.equal(res1.score, 92);
      assert.equal(res2.score, 92);
      assert.equal(completedSession.interviewState, InterviewState.COMPLETED);
    } finally {
      InterviewSession.findOne = origFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 10. Results generation after adaptive completion -> Succeeds
  // ==========================================================================
  await t.test("Requirement 10: Results generation after adaptive completion verifies terminal state in DB", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const mockTurn = {
      turnNumber: 1,
      candidateAnswer: "A closure is a function bundled with its lexical environment.",
      processingState: "ANALYZED",
      correctnessScore: 88,
      relevanceScore: 88,
      completenessScore: 88,
      answerStatus: "ACCURATE",
      topic: "JAVASCRIPT",
    };

    const savedCompletedSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.COMPLETED,
      resultsSummary: { score: 88, status: "COMPLETED" },
      coverageState: [{ topic: "JAVASCRIPT", status: "EVALUATED", coveragePercentage: 100 }],
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origTurnFind = InterviewTurn.find;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(savedCompletedSession);
      InterviewTurn.find = () => ({
        sort: () => ({ lean: async () => [mockTurn] }),
      });

      const results = await interviewResultsService.getInterviewResults(savedCompletedSession.interviewId, mockUser);
      assert.equal(results.score, 88);
      assert.equal(results.status, "COMPLETED");
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewTurn.find = origTurnFind;
    }
  });

  // ==========================================================================
  // 11. Concurrent completion requests -> Multi-instance VersionError recovery
  // ==========================================================================
  await t.test("Requirement 11: Concurrent completion requests safely recover without VersionError crash", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    let versionAttempts = 0;
    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      save: async function () {
        versionAttempts++;
        if (versionAttempts === 1) {
          const err = new Error("No matching document found for id version 0");
          err.name = "VersionError";
          throw err;
        }
        return this;
      },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(null);
      interviewResultsService.getInterviewResults = async () => ({ score: 85, status: "COMPLETED" });

      const res = await interviewSessionService.completeInterview(mockSession.interviewId, mockUser);
      assert.equal(res.status, "COMPLETED");
      assert.equal(res.score, 85);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 12. Unanswered turn handling on adaptive completion
  // ==========================================================================
  await t.test("Requirement 12: Adaptive completion marks trailing unanswered turn as SKIPPED/EVALUATED", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 0,
      endTime: new Date(Date.now() - 5000),
      planId: new mongoose.Types.ObjectId(),
      coverageState: [{ topic: "NODE.JS", status: "IN_PROGRESS" }],
      save: async function () { return this; },
    };

    const mockPlan = {
      _id: mockSession.planId,
      globalQuestionLimit: 3,
    };

    const unansweredTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 3,
      candidateAnswer: null, // Candidate did not answer before expiry
      processingState: "QUESTION_GENERATED",
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origTurnFindById = InterviewTurn.findById;
    const origPlanFindById = InterviewPlan.findById;
    const origDetermineAction = adaptiveEngineService.determineNextAction;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(unansweredTurn);
      InterviewTurn.findById = () => makeMongooseQuery(unansweredTurn);
      InterviewPlan.findById = () => makeMongooseQuery(mockPlan);

      adaptiveEngineService.determineNextAction = () => ({
        action: InterviewAction.COMPLETE_INTERVIEW,
        reason: "Interview duration has expired.",
        decisionAudit: { trigger: "DURATION_EXPIRED" },
      });

      interviewResultsService.getInterviewResults = async () => ({ score: 65, status: "COMPLETED" });

      const res = await interviewSessionService.processNextAction(mockSession.interviewId, mockUser);

      assert.equal(res.nextAction, InterviewAction.COMPLETE_INTERVIEW);
      assert.equal(mockSession.interviewState, InterviewState.COMPLETED);
      assert.equal(unansweredTurn.answerStatus, "SKIPPED");
      assert.equal(unansweredTurn.processingState, "EVALUATED");
      assert.equal(unansweredTurn.correctnessScore, 0);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      InterviewTurn.findById = origTurnFindById;
      InterviewPlan.findById = origPlanFindById;
      adaptiveEngineService.determineNextAction = origDetermineAction;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });
});
