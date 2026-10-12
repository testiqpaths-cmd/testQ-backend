import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { interviewSessionService, InterviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";
import { InterviewPlan } from "../src/ai-interview/schemas/interview-plan.schema.js";
import { interviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { answerAnalysisService, AnswerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { integrityService } from "../src/ai-interview/services/integrity.service.js";
import { conceptHistoryService } from "../src/ai-interview/services/concept-history.service.js";

test("AI Interview Duration & Completion Lifecycle Suite", async (t) => {
  const engine = new AdaptiveEngineService();

  const makeMongooseQuery = (doc) => ({
    populate: () => makeMongooseQuery(doc),
    sort: () => makeMongooseQuery(doc),
    select: () => makeMongooseQuery(doc),
    lean: () => makeMongooseQuery(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
    catch: (reject) => Promise.resolve(doc).catch(reject),
  });

  // ==========================================================================
  // 1. Authoritative Wall-Clock Expiration using endTime
  // ==========================================================================
  await t.test("Wall-clock expiration: past endTime triggers COMPLETE_INTERVIEW regardless of timeRemaining", () => {
    const expiredSession = {
      interviewId: "int-wall-clock-1",
      interviewState: InterviewState.IN_PROGRESS,
      // timeRemaining claims 1200 seconds remaining, but wall-clock endTime passed 5 seconds ago
      timeRemaining: 1200,
      endTime: new Date(Date.now() - 5000),
      questionCount: 3,
    };
    const plan = { globalQuestionLimit: 10 };

    const decision = engine.determineNextAction(expiredSession, plan);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
    assert.equal(decision.decisionAudit?.trigger, "DURATION_EXPIRED");
    assert.equal(decision.decisionAudit?.reason, "DURATION_EXPIRED");
  });

  await t.test("Wall-clock expiration: active endTime with future timestamp permits continued interview", () => {
    const activeSession = {
      interviewId: "int-wall-clock-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      timeRemaining: 900,
      endTime: new Date(Date.now() + 900000),
      questionCount: 2,
      topicQuestionCount: 1,
      topicOrder: ["NODE.JS", "POSTGRESQL"],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3 };
    const lastTurn = {
      turnNumber: 2,
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 80,
    };

    const decision = engine.determineNextAction(activeSession, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });

  // ==========================================================================
  // 2. Evidence-Based Early Completion across Mandatory Competencies
  // ==========================================================================
  await t.test("Early completion: adequate evidence across ALL mandatory competencies triggers early completion", () => {
    const fullyEvidencedSession = {
      interviewId: "int-evidence-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 4,
      topicQuestionCount: 2,
      timeRemaining: 1200,
      endTime: new Date(Date.now() + 1200000),
      topicOrder: ["NODE.JS", "POSTGRESQL"],
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 2,
          evidenceLevel: "MEDIUM",
          depthLevel: "ADEQUATE",
          knowledgeLevel: "STRONG",
          bestScore: 85,
          averageScore: 82,
          depthEstablished: true,
          knowledgeGaps: 0,
          misconceptions: [],
          contradictions: [],
        },
        {
          topic: "POSTGRESQL",
          questionsAsked: 2,
          evidenceLevel: "HIGH",
          depthLevel: "DEEP",
          knowledgeLevel: "EXCELLENT",
          bestScore: 92,
          averageScore: 88,
          depthEstablished: true,
          knowledgeGaps: 0,
          misconceptions: [],
          contradictions: [],
        },
      ],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3 };
    const lastTurn = {
      turnNumber: 4,
      topic: "NODE.JS",
      difficulty: Difficulty.HARD,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 85,
      completenessScore: 85,
      relevanceScore: 90,
      depthLevel: "ADEQUATE",
    };

    const decision = engine.determineNextAction(fullyEvidencedSession, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
    assert.equal(decision.decisionAudit?.trigger, "COMPETENCY_EVIDENCE_SATISFIED");
    assert.equal(decision.decisionAudit?.reason, "EVIDENCE_SUFFICIENCY_MET");
  });

  await t.test("Early completion gate: rejects early completion when a mandatory topic is UNVISITED", () => {
    const partialSession = {
      interviewId: "int-evidence-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 2,
      topicQuestionCount: 2,
      timeRemaining: 1200,
      endTime: new Date(Date.now() + 1200000),
      topicOrder: ["NODE.JS", "POSTGRESQL"],
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 2,
          evidenceLevel: "HIGH",
          depthLevel: "DEEP",
          knowledgeLevel: "EXCELLENT",
          bestScore: 95,
          averageScore: 90,
          depthEstablished: true,
          knowledgeGaps: 0,
          misconceptions: [],
          contradictions: [],
        },
        {
          topic: "POSTGRESQL",
          questionsAsked: 0, // Unvisited! Missing evidence
          evidenceLevel: "LOW",
          depthLevel: "SHALLOW",
          knowledgeLevel: "NONE",
          bestScore: 0,
          averageScore: 0,
          depthEstablished: false,
          knowledgeGaps: 0,
          misconceptions: [],
          contradictions: [],
        },
      ],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3 };
    const lastTurn = {
      turnNumber: 2,
      topic: "NODE.JS",
      difficulty: Difficulty.HARD,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 95,
      completenessScore: 90,
      relevanceScore: 95,
      depthLevel: "DEEP",
    };

    assert.equal(engine.hasAdequateEvidenceAcrossAllCompetencies(partialSession, plan, lastTurn), false);
    const decision = engine.determineNextAction(partialSession, plan, lastTurn);
    // Must switch to the unvisited topic, NOT terminate early
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "POSTGRESQL");
  });

  await t.test("Early completion gate: rejects early completion when evidenceLevel is LOW", () => {
    const lowEvidenceSession = {
      interviewId: "int-evidence-3",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 2,
      timeRemaining: 1200,
      endTime: new Date(Date.now() + 1200000),
      topicOrder: ["NODE.JS"],
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 1,
          evidenceLevel: "LOW", // Low evidence cannot justify early exit
          depthLevel: "ADEQUATE",
          knowledgeLevel: "STRONG",
          bestScore: 80,
          averageScore: 80,
          depthEstablished: true,
          knowledgeGaps: 0,
          misconceptions: [],
        },
      ],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10 };
    assert.equal(engine.hasAdequateEvidenceAcrossAllCompetencies(lowEvidenceSession, plan), false);
  });

  await t.test("Early completion gate: rejects early completion when topic has unresolved knowledge gap", () => {
    const gapSession = {
      interviewId: "int-evidence-4",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 4,
      timeRemaining: 1200,
      endTime: new Date(Date.now() + 1200000),
      topicOrder: ["NODE.JS"],
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 4,
          evidenceLevel: "HIGH",
          depthLevel: "DEEP",
          knowledgeLevel: "STRONG",
          bestScore: 85,
          averageScore: 75,
          depthEstablished: true,
          knowledgeGaps: 1, // Unresolved gap present!
          misconceptions: [],
        },
      ],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10 };
    assert.equal(engine.hasAdequateEvidenceAcrossAllCompetencies(gapSession, plan), false);
  });

  // ==========================================================================
  // 3. Serialized Session Lock (#withSessionLock)
  // ==========================================================================
  await t.test("Session lock serialization: concurrent operations for same session run sequentially", async () => {
    const sessionId = "int-lock-test-1";
    const executionOrder = [];

    // Simulate Operation 1: Answer submission taking 30ms
    const op1 = interviewSessionService._withSessionLock(sessionId, async () => {
      await new Promise((r) => setTimeout(r, 30));
      executionOrder.push("op1_finish");
      return { op: "submitAnswer", turn: 1 };
    });

    // Simulate Operation 2: Finalize interview arriving 5ms later while Op 1 is in-flight
    await new Promise((r) => setTimeout(r, 5));
    const op2 = interviewSessionService._withSessionLock(sessionId, async () => {
      executionOrder.push("op2_finish");
      return { op: "completeInterview", status: "COMPLETED" };
    });

    const [res1, res2] = await Promise.all([op1, op2]);

    // Op 1 must complete before Op 2 begins
    assert.deepEqual(executionOrder, ["op1_finish", "op2_finish"]);

    // Op 2 must receive its OWN result, NOT Op 1's return value
    assert.equal(res1.op, "submitAnswer");
    assert.equal(res2.op, "completeInterview");
    assert.equal(res2.status, "COMPLETED");
  });

  await t.test("Session lock error isolation: failure in first operation does not abort queued second operation", async () => {
    const sessionId = "int-lock-error-1";
    const results = [];

    const failingOp = interviewSessionService._withSessionLock(sessionId, async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("Transitory submission error");
    });

    const succeedingOp = interviewSessionService._withSessionLock(sessionId, async () => {
      results.push("succeeded");
      return { status: "COMPLETED" };
    });

    await assert.rejects(failingOp, /Transitory submission error/);
    const res2 = await succeedingOp;
    assert.equal(res2.status, "COMPLETED");
    assert.deepEqual(results, ["succeeded"]);
  });

  // ==========================================================================
  // 4. Idempotent Completion Under Concurrent Requests
  // ==========================================================================
  await t.test("Idempotent completion: concurrent completeInterview calls return results safely", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 100,
      endTime: new Date(Date.now() + 100000),
      coverageState: [{ topic: "REACT", status: "IN_PROGRESS" }],
      resultsSummary: null,
      save: async function () { return this; },
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 1,
      candidateAnswer: "React uses a virtual DOM for efficient reconciliation.",
      processingState: "SUBMITTED",
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origAnalyze = answerAnalysisService.analyzeTurnAnswer;
    const origGetResults = interviewResultsService.getInterviewResults;

    let analyzeCount = 0;
    let finalizeCount = 0;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(mockTurn);

      answerAnalysisService.analyzeTurnAnswer = async () => {
        analyzeCount++;
        mockTurn.processingState = "ANALYZED";
        return { success: true };
      };

      interviewResultsService.getInterviewResults = async () => {
        finalizeCount++;
        return { score: 85, status: "COMPLETED" };
      };

      // Fire 2 simultaneous completion requests (e.g. client timer expiry + candidate click "End Interview")
      const [r1, r2] = await Promise.all([
        interviewSessionService.completeInterview(mockSession.interviewId, mockUser),
        interviewSessionService.completeInterview(mockSession.interviewId, mockUser),
      ]);

      assert.equal(r1.score, 85);
      assert.equal(r2.score, 85);
      // Analyze turn must only run once
      assert.equal(analyzeCount, 1);
      assert.equal(mockSession.interviewState, InterviewState.COMPLETED);
      assert.equal(mockSession.timeRemaining, 0);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      answerAnalysisService.analyzeTurnAnswer = origAnalyze;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 5. Partial Evaluation on Hard Deadline Expiry
  // ==========================================================================
  await t.test("Partial evaluation: answer submitted at deadline is scored and preserved in completeInterview", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 0,
      endTime: new Date(Date.now() - 1000), // Expired
      coverageState: [{ topic: "REACT", status: "IN_PROGRESS" }],
      save: async function () { return this; },
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 2,
      candidateAnswer: "useMemo caches calculation results between re-renders.",
      processingState: "SUBMITTED",
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origAnalyze = answerAnalysisService.analyzeTurnAnswer;
    const origGetResults = interviewResultsService.getInterviewResults;

    let analyzedTurnId = null;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(mockTurn);

      answerAnalysisService.analyzeTurnAnswer = async ({ turnId }) => {
        analyzedTurnId = turnId;
        mockTurn.processingState = "ANALYZED";
        return { success: true };
      };

      interviewResultsService.getInterviewResults = async () => {
        return { score: 88, status: "COMPLETED" };
      };

      const result = await interviewSessionService.completeInterview(mockSession.interviewId, mockUser);

      // The in-flight submitted answer must be analyzed rather than discarded
      assert.equal(analyzedTurnId, mockTurn._id);
      assert.equal(mockSession.interviewState, InterviewState.COMPLETED);
      assert.equal(result.score, 88);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      answerAnalysisService.analyzeTurnAnswer = origAnalyze;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 6. Recovery of Expired and Abandoned Sessions
  // ==========================================================================
  await t.test("Session recovery: resuming a session after endTime passes automatically finalizes it", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const abandonedSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 1800,
      currentQuestion: { id: "q1", questionText: "Explain closures." },
      // Started 2 hours ago with 30-minute duration -> expired 1.5 hours ago
      startTime: new Date(Date.now() - 7200000),
      endTime: new Date(Date.now() - 5400000),
      coverageState: [{ topic: "JAVASCRIPT", status: "IN_PROGRESS" }],
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(abandonedSession);
      InterviewSession.findById = () => makeMongooseQuery(abandonedSession);
      InterviewTurn.findOne = () => makeMongooseQuery(null);

      interviewResultsService.getInterviewResults = async () => {
        return { score: 0, status: "COMPLETED" };
      };

      const data = await interviewSessionService.startInterview(abandonedSession.interviewId, mockUser);

      // Must complete the session, set timeRemaining to 0, and return completed results
      assert.equal(abandonedSession.interviewState, InterviewState.COMPLETED);
      assert.equal(abandonedSession.timeRemaining, 0);
      assert.equal(data.status, "COMPLETED");
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 7. Frontend Countdown Calculation & Drift-Free Wall-Clock Sync
  // ==========================================================================
  await t.test("Frontend countdown sync logic: computes remaining seconds accurately from endTime across evaluation", () => {
    const durationMinutes = 30;
    const now = Date.now();
    const endTimeMs = now + 15 * 60 * 1000; // 15 minutes remaining

    // 1. Initial calculation on reconnect / refresh
    const initialSec = Math.max(0, Math.round((endTimeMs - now) / 1000));
    assert.equal(initialSec, 900); // 15 minutes, NOT reset to 30 minutes!

    // 2. Continuous evaluation: after 8 seconds of LLM evaluation
    const afterEvalNow = now + 8000;
    const secAfterEval = Math.max(0, Math.round((endTimeMs - afterEvalNow) / 1000));
    assert.equal(secAfterEval, 892); // Counted down across evaluation!

    // 3. Background tab resume: after 100 seconds in background
    const afterTabResume = now + 100000;
    const secAfterResume = Math.max(0, Math.round((endTimeMs - afterTabResume) / 1000));
    assert.equal(secAfterResume, 800); // No drift from background throttling
  });

  // ==========================================================================
  // 8. Deadline Boundary: Just Before, Exactly At, and Just After endTime
  // ==========================================================================
  await t.test("Deadline boundary: behavior just before, exactly at, and just after endTime", () => {
    const boundaryTime = Date.now();
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3 };

    // Case A: 120 seconds before deadline (well above 60s emergency grace period) -> active
    const justBefore = {
      interviewId: "int-bound-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      timeRemaining: 120,
      endTime: new Date(boundaryTime + 120000),
      questionCount: 2,
    };
    const decBefore = engine.determineNextAction(justBefore, plan, { answerStatus: AnswerStatus.ACCURATE, correctnessScore: 80 });
    assert.notEqual(decBefore.action, InterviewAction.COMPLETE_INTERVIEW);

    // Case B: Exactly at deadline -> expired
    const exactlyAt = {
      interviewId: "int-bound-2",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 0,
      endTime: new Date(boundaryTime),
      questionCount: 2,
    };
    const decExact = engine.determineNextAction(exactlyAt, plan);
    assert.equal(decExact.action, InterviewAction.COMPLETE_INTERVIEW);
    assert.equal(decExact.decisionAudit.reason, "DURATION_EXPIRED");

    // Case C: 1 second after deadline -> expired
    const justAfter = {
      interviewId: "int-bound-3",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 0,
      endTime: new Date(boundaryTime - 1000),
      questionCount: 2,
    };
    const decAfter = engine.determineNextAction(justAfter, plan);
    assert.equal(decAfter.action, InterviewAction.COMPLETE_INTERVIEW);
    assert.equal(decAfter.decisionAudit.reason, "DURATION_EXPIRED");
  });

  // ==========================================================================
  // 9. Evaluation Crossing Deadline: Submit Before, Finish LLM Eval After
  // ==========================================================================
  await t.test("Evaluation crossing deadline: answer submitted before expiry is scored, and session completes when eval finishes after expiry", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    // Deadline was 100ms in the future when answer submitted, but passes during evaluation
    const deadline = new Date(Date.now() + 50);

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.WAITING_FOR_NEXT_QUESTION,
      duration: 30,
      timeRemaining: 5,
      endTime: deadline,
      questionCount: 3,
      planId: new mongoose.Types.ObjectId(),
      coverageState: [{ topic: "NODE.JS", status: "IN_PROGRESS", questionsAsked: 1 }],
      save: async function () { return this; },
    };

    const mockPlan = {
      _id: mockSession.planId,
      globalQuestionLimit: 10,
      maxQuestionsPerTopic: 3,
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 3,
      candidateAnswer: "Worker threads share memory via SharedArrayBuffer.",
      processingState: "SUBMITTED",
      topic: "NODE.JS",
      questionType: "TECHNICAL",
      correctnessScore: 92,
      relevanceScore: 90,
      completenessScore: 88,
      confidence: 85,
      answerStatus: AnswerStatus.ACCURATE,
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origTurnFindById = InterviewTurn.findById;
    const origPlanFindById = InterviewPlan.findById;
    const origAnalyze = answerAnalysisService.analyzeTurnAnswer;
    const origGetResults = interviewResultsService.getInterviewResults;

    let evalFinishedAfterDeadline = false;
    let turnWasAnalyzed = false;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      InterviewSession.findById = () => makeMongooseQuery(mockSession);
      InterviewTurn.findOne = () => makeMongooseQuery(mockTurn);
      InterviewTurn.findById = () => makeMongooseQuery(mockTurn);
      InterviewPlan.findById = () => makeMongooseQuery(mockPlan);

      answerAnalysisService.analyzeTurnAnswer = async () => {
        // Simulate LLM latency crossing past deadline
        await new Promise((r) => setTimeout(r, 80));
        evalFinishedAfterDeadline = Date.now() >= deadline.getTime();
        turnWasAnalyzed = true;
        mockTurn.processingState = "ANALYZED";
        return { success: true, latencyMetrics: { answerAnalysisMs: 80 } };
      };

      interviewResultsService.getInterviewResults = async () => {
        return { score: 90, status: "COMPLETED" };
      };

      const result = await interviewSessionService.processNextAction(mockSession.interviewId, mockUser);

      assert.equal(turnWasAnalyzed, true);
      assert.equal(evalFinishedAfterDeadline, true);
      // Engine must cleanly trigger COMPLETE_INTERVIEW because deadline expired
      assert.equal(result.nextAction, InterviewAction.COMPLETE_INTERVIEW);
      assert.equal(result.interviewState, InterviewState.COMPLETED);
      assert.equal(mockSession.interviewState, InterviewState.COMPLETED);
      assert.equal(mockSession.timeRemaining, 0);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      InterviewTurn.findById = origTurnFindById;
      InterviewPlan.findById = origPlanFindById;
      answerAnalysisService.analyzeTurnAnswer = origAnalyze;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 10. Multi-Instance Production Persistence & Cross-Instance Conflict
  // ==========================================================================
  await t.test("Multi-instance persistence: VersionError on concurrent completeInterview safely recovers without crashing", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-cross-instance-1`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 100,
      endTime: new Date(Date.now() + 100000),
      coverageState: [{ topic: "REACT", status: "IN_PROGRESS" }],
      // Simulate VersionError when saving due to concurrent instance mutation
      save: async function () {
        const err = new Error("No matching document found for id version 2");
        err.name = "VersionError";
        throw err;
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

      interviewResultsService.getInterviewResults = async () => {
        return { score: 85, status: "COMPLETED", resolvedViaConflictRecovery: true };
      };

      // Instance B completes while Instance A already incremented document version
      const result = await interviewSessionService.completeInterview(mockSession.interviewId, mockUser);

      // Must catch VersionError and return finalized results cleanly rather than throwing 500
      assert.equal(result.score, 85);
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.resolvedViaConflictRecovery, true);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findOne = origTurnFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  await t.test("Multi-instance persistence: VersionError on submitAnswer concurrent completion returns cleanly", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const mockSession = {
      _id: testSessionId,
      interviewId: `int-cross-instance-2`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 100,
      endTime: new Date(Date.now() + 100000),
      currentQuestion: { id: "turn-cross-1" },
      save: async function () {
        const err = new Error("No matching document found for id version 2");
        err.name = "VersionError";
        throw err;
      },
    };

    const completedSession = {
      ...mockSession,
      interviewState: InterviewState.COMPLETED,
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 1,
      candidateAnswer: null,
      processingState: "PENDING",
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindById = InterviewTurn.findById;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(mockSession);
      // On reload after VersionError, instance sees COMPLETED
      InterviewSession.findById = () => makeMongooseQuery(completedSession);
      InterviewTurn.findById = () => makeMongooseQuery(mockTurn);

      const res = await interviewSessionService.submitAnswer(
        mockSession.interviewId,
        mockUser,
        { answer: "React virtual DOM diffing", timeTakenSeconds: 15 }
      );

      assert.equal(res.answerSaved, true);
      assert.equal(res.isFinished, true);
      assert.equal(res.interviewState, InterviewState.COMPLETED);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findById = origTurnFindById;
    }
  });

  // ==========================================================================
  // 11. Evidence Gate Quality: Misleading Scores & Genuine Evidence
  // ==========================================================================
  await t.test("Evidence gate: rejects early completion when high scores exist but depthLevel is SHALLOW", () => {
    const shallowSession = {
      interviewId: "int-shallow-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 3,
      timeRemaining: 1200,
      endTime: new Date(Date.now() + 1200000),
      topicOrder: ["NODE.JS"],
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 3,
          evidenceLevel: "MEDIUM",
          depthLevel: "SHALLOW", // High score but shallow depth!
          knowledgeLevel: "STRONG",
          bestScore: 95,
          averageScore: 92,
          depthEstablished: false,
          knowledgeGaps: 0,
          misconceptions: [],
          contradictions: [],
        },
      ],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10 };
    assert.equal(engine.hasAdequateEvidenceAcrossAllCompetencies(shallowSession, plan), false);
  });

  await t.test("Evidence gate: rejects early completion when depthEstablished is false despite good scores", () => {
    const unestablishedSession = {
      interviewId: "int-unestablished-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 3,
      timeRemaining: 1200,
      endTime: new Date(Date.now() + 1200000),
      topicOrder: ["NODE.JS"],
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 2,
          evidenceLevel: "HIGH",
          depthLevel: "ADEQUATE",
          knowledgeLevel: "STRONG",
          bestScore: 85,
          averageScore: 82,
          depthEstablished: false, // Depth not confirmed!
          knowledgeGaps: 0,
          misconceptions: [],
          contradictions: [],
        },
      ],
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10 };
    assert.equal(engine.hasAdequateEvidenceAcrossAllCompetencies(unestablishedSession, plan), false);
  });

  // ==========================================================================
  // 12. Final Report Integrity: Scores, Unanswered Turns, and Completion Reasons
  // ==========================================================================
  await t.test("Final report integrity: unanswered turns scored 0 as SKIPPED and completed results accurately computed", async () => {
    const testSessionId = new mongoose.Types.ObjectId();
    const session = {
      _id: testSessionId,
      interviewId: `int-report-1`,
      interviewState: InterviewState.COMPLETED,
      planId: new mongoose.Types.ObjectId(),
      coverageState: [
        { topic: "JAVASCRIPT", coveragePercentage: 80, knowledgeLevel: "ADVANCED" },
        { topic: "REACT", coveragePercentage: 0, knowledgeLevel: "NONE", knowledgeGaps: 1 },
      ],
    };

    const plan = {
      _id: session.planId,
      globalQuestionLimit: 3,
    };

    const turns = [
      // Turn 1: Answered accurately
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 1,
        topic: "JAVASCRIPT",
        questionType: "TECHNICAL",
        candidateAnswer: "Closures capture lexical scope.",
        processingState: "ANALYZED",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 85,
        isFollowUp: false,
      },
      // Turn 2: Skipped / unanswered when deadline hit
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 2,
        topic: "REACT",
        questionType: "TECHNICAL",
        candidateAnswer: "",
        answerStatus: "SKIPPED",
        endedReason: "deadline_timeout",
        processingState: "EVALUATED",
        correctnessScore: 0,
        relevanceScore: 0,
        completenessScore: 0,
        confidence: 0,
        isFollowUp: false,
      },
    ];

    const origTurnFind = InterviewTurn.find;
    const origPlanFindById = InterviewPlan.findById;
    const origAiFeedback = interviewResultsService.ai.generateInterviewFeedback;
    const origIntegrity = integrityService.summaryForSession;

    try {
      InterviewTurn.find = () => ({
        sort: () => ({ lean: async () => turns }),
      });
      InterviewPlan.findById = () => ({
        lean: async () => plan,
      });
      interviewResultsService.ai.generateInterviewFeedback = async () => ({
        overallFeedback: "Solid fundamentals in JavaScript; practice React.",
        perQuestion: [],
      });
      integrityService.summaryForSession = async () => ({ totalSignals: 0 });

      const report = await interviewResultsService.computeResultsForSession(session);

      // Turn 1 score = 0.6*90 + 0.2*90 + 0.2*90 = 90
      // Turn 2 score = 0 (skipped)
      // Overall score = (90 + 0) / 2 = 45
      assert.equal(report.score, 45);
      assert.ok(report.readinessScore > 0);
      assert.equal(report.questions.length, 2);
      assert.equal(report.questions[0].score, 90);
      assert.equal(report.questions[1].score, 0);
      assert.equal(report.questions[1].endedReason, "deadline_timeout");
      assert.equal(report.questions[1].answerStatus, "SKIPPED");
      assert.ok(Array.isArray(report.strengths));
      assert.ok(Array.isArray(report.weaknesses));
      // Weakness should include React due to knowledge gap
      assert.ok(report.weaknesses.some((w) => w.toLowerCase().includes("react")));
    } finally {
      InterviewTurn.find = origTurnFind;
      InterviewPlan.findById = origPlanFindById;
      interviewResultsService.ai.generateInterviewFeedback = origAiFeedback;
      integrityService.summaryForSession = origIntegrity;
    }
  });

  // ==========================================================================
  // 13. Real Multi-Instance Concurrency (Two Distinct Service Instances)
  // ==========================================================================
  await t.test("Multi-instance concurrency: two distinct service instances mutating shared session document", async () => {
    const instanceA = new InterviewSessionService();
    const instanceB = new InterviewSessionService();

    assert.notEqual(instanceA, instanceB);

    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    let sharedDocVersion = 0;
    const sharedSessionDoc = {
      _id: testSessionId,
      interviewId: `int-multi-inst-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      duration: 30,
      timeRemaining: 60,
      endTime: new Date(Date.now() + 60000),
      currentQuestion: { id: "turn-mi-1" },
      coverageState: [{ topic: "NODE.JS", status: "IN_PROGRESS" }],
      save: async function () {
        if (this.__v !== undefined && this.__v !== sharedDocVersion) {
          const err = new Error("No matching document found for id version " + this.__v);
          err.name = "VersionError";
          throw err;
        }
        sharedDocVersion++;
        this.__v = sharedDocVersion;
        return this;
      },
    };

    const mockTurn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 1,
      candidateAnswer: null,
      processingState: "PENDING",
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;
    const origTurnFindById = InterviewTurn.findById;
    const origTurnFindOne = InterviewTurn.findOne;
    const origGetResults = interviewResultsService.getInterviewResults;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(sharedSessionDoc);
      InterviewSession.findById = () => makeMongooseQuery(sharedSessionDoc);
      InterviewTurn.findById = () => makeMongooseQuery(mockTurn);
      InterviewTurn.findOne = () => makeMongooseQuery(null);

      interviewResultsService.getInterviewResults = async () => ({
        score: 80,
        status: "COMPLETED",
      });

      // Fire Instance A (completeInterview) and Instance B (submitAnswer) concurrently
      const [resComplete, resSubmit] = await Promise.all([
        instanceA.completeInterview(sharedSessionDoc.interviewId, mockUser),
        instanceB.submitAnswer(sharedSessionDoc.interviewId, mockUser, {
          answer: "Node.js uses libuv for asynchronous I/O",
          timeTakenSeconds: 10,
        }),
      ]);

      // Both instances succeed without throwing unhandled VersionError
      assert.equal(resComplete.status, "COMPLETED");
      assert.equal(resSubmit.answerSaved, true);
      assert.equal(sharedSessionDoc.interviewState, InterviewState.COMPLETED);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
      InterviewTurn.findById = origTurnFindById;
      InterviewTurn.findOne = origTurnFindOne;
      interviewResultsService.getInterviewResults = origGetResults;
    }
  });

  // ==========================================================================
  // 14. Exactly-Once Effective Scoring on Duplicate Evaluation Calls
  // ==========================================================================
  await t.test("Exactly-once scoring: duplicate evaluation requests do not duplicate scores or topic questions", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const turnDoc = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 1,
      topic: "NODE.JS",
      candidateAnswer: "Event loop coordinates non-blocking I/O operations.",
      processingState: "SUBMITTED",
      save: async function () { return this; },
    };

    const sessionDoc = {
      _id: testSessionId,
      interviewId: `int-scoring-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      questionCount: 1,
      coverageState: [
        {
          topic: "NODE.JS",
          questionsAsked: 1,
          coveragePercentage: 0,
          knowledgeLevel: "NONE",
          knowledgeGaps: 0,
          bestScore: 0,
          averageScore: 0,
          status: "IN_PROGRESS",
        },
      ],
      candidatePerformance: { topicScores: {}, globalAverageScore: 0 },
      save: async function () { return this; },
    };

    const origSessionFindOne = InterviewSession.findOne;
    const origTurnFindById = InterviewTurn.findById;
    const origTurnFind = InterviewTurn.find;
    const origPlanFindById = InterviewPlan.findById;
    const origRecordTurn = conceptHistoryService.recordTurn;
    let rawAiCallCount = 0;

    const mockAi = {
      analyzeCandidateAnswer: async () => {
        rawAiCallCount++;
        return {
          answerStatus: AnswerStatus.ACCURATE,
          relevanceScore: 90,
          correctnessScore: 92,
          completenessScore: 88,
          confidence: 85,
          conceptsDemonstrated: ["event_loop"],
          conceptsMissing: [],
          depthLevel: "DEEP",
          knowledgeLevel: "STRONG",
          feedbackSummary: "Accurate explanation of event loop.",
        };
      },
    };

    const analysisService = new AnswerAnalysisService(mockAi);

    try {
      conceptHistoryService.recordTurn = async () => {};
      InterviewSession.findOne = () => makeMongooseQuery(sessionDoc);
      InterviewTurn.findById = () => makeMongooseQuery(turnDoc);
      InterviewTurn.find = () => makeMongooseQuery([turnDoc]);
      InterviewPlan.findById = () => makeMongooseQuery({ _id: new mongoose.Types.ObjectId(), globalQuestionLimit: 10 });

      // Call 1
      const eval1 = await analysisService.analyzeTurnAnswer({
        sessionId: sessionDoc.interviewId,
        user: mockUser,
        turnId: turnDoc._id,
      });

      // Call 2: Duplicate request on already analyzed turn
      const eval2 = await analysisService.analyzeTurnAnswer({
        sessionId: sessionDoc.interviewId,
        user: mockUser,
        turnId: turnDoc._id,
      });

      // AI evaluation must run exactly once
      assert.equal(rawAiCallCount, 1);
      // Both calls return identical consistent scores
      assert.equal(eval1.correctnessScore, 92);
      assert.equal(eval2.correctnessScore, 92);
      assert.equal(eval1.answerStatus, AnswerStatus.ACCURATE);
      assert.equal(eval2.answerStatus, AnswerStatus.ACCURATE);
      // Topic bestScore updated exactly once
      assert.equal(sessionDoc.coverageState[0].bestScore, 92);
      assert.equal(sessionDoc.coverageState[0].questionsAsked, 1);
    } finally {
      InterviewSession.findOne = origSessionFindOne;
      InterviewTurn.findById = origTurnFindById;
      InterviewTurn.find = origTurnFind;
      InterviewPlan.findById = origPlanFindById;
      conceptHistoryService.recordTurn = origRecordTurn;
    }
  });

  // ==========================================================================
  // 15. Deadline Policy Consistency: Post-Expiration Submissions Rejected
  // ==========================================================================
  await t.test("Deadline policy consistency: submitAnswer and processNextAction reject submissions once completed", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const completedSession = {
      _id: testSessionId,
      interviewId: `int-post-exp-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.COMPLETED,
      duration: 30,
      timeRemaining: 0,
      endTime: new Date(Date.now() - 10000), // Expired 10s ago
      currentQuestion: null,
      save: async function () { return this; },
    };

    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;

    try {
      InterviewSession.findOne = () => makeMongooseQuery(completedSession);
      InterviewSession.findById = () => makeMongooseQuery(completedSession);

      // 1. Calling submitAnswer on completed session must be rejected with 400
      await assert.rejects(
        interviewSessionService.submitAnswer(completedSession.interviewId, mockUser, {
          answer: "Trying to answer after session is finished",
        }),
        (err) => err.statusCode === 400 && err.message.includes("COMPLETED")
      );

      // 2. Calling processNextAction on completed session returns terminal COMPLETE_INTERVIEW without generating new questions
      const nextActionRes = await interviewSessionService.processNextAction(completedSession.interviewId, mockUser);
      assert.equal(nextActionRes.nextAction, InterviewAction.COMPLETE_INTERVIEW);
      assert.equal(nextActionRes.interviewState, InterviewState.COMPLETED);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
    }
  });

  // ==========================================================================
  // 16. Evidence Correctness: CoverageState Derived From Persisted Turn
  // ==========================================================================
  await t.test("Evidence correctness: questionsAsked, depth, and misconceptions directly derived from persisted turn", async () => {
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const mockUser = { _id: new mongoose.Types.ObjectId(), role: "student" };

    const turnWithMisconception = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: testSessionId,
      turnNumber: 2,
      topic: "POSTGRESQL",
      candidateAnswer: "PostgreSQL uses row-level locking for all vacuum operations.",
      processingState: "SUBMITTED",
      save: async function () { return this; },
    };

    const sessionDoc = {
      _id: testSessionId,
      interviewId: `int-evid-correct-${testSessionId}`,
      userId: mockUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      questionCount: 2,
      coverageState: [
        {
          topic: "POSTGRESQL",
          questionsAsked: 1,
          knowledgeGaps: 0,
          misconceptions: [],
          depthEstablished: false,
          knowledgeLevel: "INTERMEDIATE",
          bestScore: 70,
          averageScore: 70,
          status: "IN_PROGRESS",
        },
      ],
      candidatePerformance: { topicScores: {} },
      save: async function () { return this; },
    };

    const origSessionFindOne = InterviewSession.findOne;
    const origTurnFindById = InterviewTurn.findById;
    const origTurnFind = InterviewTurn.find;
    const origPlanFindById = InterviewPlan.findById;
    const origRecordTurn = conceptHistoryService.recordTurn;

    const mockAi = {
      analyzeCandidateAnswer: async () => ({
        answerStatus: AnswerStatus.PARTIAL,
        relevanceScore: 70,
        correctnessScore: 60,
        completenessScore: 60,
        confidence: 80,
        conceptsDemonstrated: ["vacuum"],
        conceptsMissing: ["table_locks", "multiversion_concurrency"],
        depthLevel: "SHALLOW",
        knowledgeLevel: "INTERMEDIATE",
        misconceptions: ["Vacuum takes table lock instead of row lock"],
        contradictionDetected: true,
        feedbackSummary: "VACUUM requires table lock modes, not just row lock.",
      }),
    };

    const analysisService = new AnswerAnalysisService(mockAi);

    try {
      conceptHistoryService.recordTurn = async () => {};
      InterviewSession.findOne = () => makeMongooseQuery(sessionDoc);
      InterviewTurn.findById = () => makeMongooseQuery(turnWithMisconception);
      InterviewTurn.find = () => makeMongooseQuery([turnWithMisconception]);
      InterviewPlan.findById = () => makeMongooseQuery({ _id: new mongoose.Types.ObjectId(), globalQuestionLimit: 10 });

      await analysisService.analyzeTurnAnswer({
        sessionId: sessionDoc.interviewId,
        user: mockUser,
        turnId: turnWithMisconception._id,
      });

      const pgCoverage = sessionDoc.coverageState.find((c) => c.topic === "POSTGRESQL");
      // Misconception from turn must be recorded
      assert.equal(pgCoverage.misconceptions.length, 1);
      assert.equal(pgCoverage.misconceptions[0], "Vacuum takes table lock instead of row lock");
      // depthLevel must be SHALLOW as evaluated
      assert.equal(pgCoverage.depthLevel, "SHALLOW");
      assert.equal(pgCoverage.depthEstablished, false);
      assert.ok(pgCoverage.conceptsTested.includes("vacuum"));
    } finally {
      InterviewSession.findOne = origSessionFindOne;
      InterviewTurn.findById = origTurnFindById;
      InterviewTurn.find = origTurnFind;
      InterviewPlan.findById = origPlanFindById;
      conceptHistoryService.recordTurn = origRecordTurn;
    }
  });
});
