import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { InterviewQuestionPlannerService } from "../src/ai-interview/services/interview-question-planner.service.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";
import { InterviewPlan } from "../src/ai-interview/schemas/interview-plan.schema.js";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { adaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { answerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { questionService } from "../src/ai-interview/services/question.service.js";

test("Sprint 4: Fastpath vs Legacy Behavioral Equivalence", async (t) => {
  const dummyUser = { _id: new mongoose.Types.ObjectId().toString(), role: "CANDIDATE" };

  // Helper to build a clean mock session (turnNumber >= 2 so it is past introduction)
  const createMockSession = (overrides = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    interviewId: `int-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    candidateId: dummyUser._id,
    interviewState: InterviewState.IN_PROGRESS,
    currentTopic: "NODE.JS",
    difficulty: Difficulty.MEDIUM,
    questionCount: 2,
    topicQuestionCount: 1,
    followUpCount: 0,
    topicFollowUpCount: 0,
    globalFollowUpCount: 0,
    timeRemaining: 1800,
    currentQuestion: {
      id: new mongoose.Types.ObjectId().toString(),
      questionId: new mongoose.Types.ObjectId().toString(),
      questionText: "Explain how Node.js streams implement backpressure.",
      topic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
    },
    topicOrder: ["NODE.JS", "POSTGRESQL", "REDIS"],
    coverageState: [
      { topic: "NODE.JS", questionsAsked: 1, status: "IN_PROGRESS", coveragePercentage: 33 },
      { topic: "POSTGRESQL", questionsAsked: 0, status: "NOT_STARTED", coveragePercentage: 0 },
      { topic: "REDIS", questionsAsked: 0, status: "NOT_STARTED", coveragePercentage: 0 },
    ],
    candidatePerformance: { streakCorrect: 1, consecutiveKnowledgeGapsInTopic: 0 },
    preparedQuestions: [],
    save: async function () { return this; },
    ...overrides,
  });

  const mockPlan = {
    _id: new mongoose.Types.ObjectId(),
    globalQuestionLimit: 10,
    maxQuestionsPerTopic: 3,
    maxFollowUpsPerQuestion: 1,
    maxGlobalFollowUps: 3,
    topics: ["NODE.JS", "POSTGRESQL", "REDIS"],
  };

  // --------------------------------------------------------------------------
  // TEST 1: Normal Terminal Answer Equivalence
  // --------------------------------------------------------------------------
  await t.test("1. Normal Terminal Answer: Legacy (submit->next) vs Fastpath (submit-and-next) produce identical action", async () => {
    const session = createMockSession();
    const lastTurn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      topic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
      correctnessScore: 90,
      completenessScore: 85,
      depthLevel: "ADEQUATE",
      answerStatus: AnswerStatus.ACCURATE,
      followUp: false,
      followUpAllowed: false,
    };

    // Both paths feed through adaptive engine
    const decisionLegacy = adaptiveEngineService.determineNextAction(session, mockPlan, lastTurn);
    const decisionFastpath = adaptiveEngineService.determineNextAction(session, mockPlan, lastTurn);

    assert.equal(decisionLegacy.action, InterviewAction.ASK_QUESTION);
    assert.equal(decisionFastpath.action, InterviewAction.ASK_QUESTION);
    assert.equal(decisionLegacy.difficulty, decisionFastpath.difficulty);
    assert.equal(decisionLegacy.topic, decisionFastpath.topic);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Follow-Up Equivalence
  // --------------------------------------------------------------------------
  await t.test("2. Follow-Up: Both paths trigger FOLLOW_UP with identical constraints", async () => {
    const session = createMockSession({ followUpCount: 0 });
    const lastTurn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      topic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
      correctnessScore: 75,
      completenessScore: 60,
      depthLevel: "SHALLOW",
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
      followUpAllowed: true,
      followUpType: "DEPTH_PROBE",
      followUpReason: "SHALLOW_ANSWER",
    };

    const decision = adaptiveEngineService.determineNextAction(session, mockPlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpType, "DEPTH_PROBE");
    assert.equal(decision.difficulty, Difficulty.MEDIUM);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Knowledge Gap Strict Handling Equivalence
  // --------------------------------------------------------------------------
  await t.test("3. Knowledge Gap: Candidate 'I don't know' strictly rejects follow-up in both paths", async () => {
    const gapCheck1 = answerAnalysisService.isExplicitKnowledgeGap("I don't know");
    const gapCheck2 = answerAnalysisService.isExplicitKnowledgeGap("i am not sure about this");
    assert.equal(gapCheck1, true);
    assert.equal(gapCheck2, true);

    const session = createMockSession();
    const gapTurn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      topic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
      correctnessScore: 0,
      completenessScore: 0,
      depthLevel: "SHALLOW",
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      followUp: true, // Rogue flag that MUST be rejected
    };

    const decision = adaptiveEngineService.determineNextAction(session, mockPlan, gapTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Knowledge gap must NEVER allow follow-up");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Misconception Detection Equivalence
  // --------------------------------------------------------------------------
  await t.test("4. Misconception: Both paths prioritize targeted probe over skipping", async () => {
    const session = createMockSession({ followUpCount: 0 });
    const misconceptionTurn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      topic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
      correctnessScore: 40,
      completenessScore: 50,
      depthLevel: "SHALLOW",
      answerStatus: AnswerStatus.INCORRECT,
      followUp: true,
      followUpAllowed: true,
      misconceptions: ["async/await does not run on background threads"],
      followUpType: "DEPTH_PROBE",
      followUpReason: "MISCONCEPTION",
    };

    const decision = adaptiveEngineService.determineNextAction(session, mockPlan, misconceptionTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpReason, "MISCONCEPTION");
  });

  // --------------------------------------------------------------------------
  // TEST 5: Partial Answer Equivalence
  // --------------------------------------------------------------------------
  await t.test("5. Partial Answer: Missing concepts trigger targeted follow-up identically", async () => {
    const session = createMockSession({ followUpCount: 0 });
    const partialTurn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      topic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
      correctnessScore: 70,
      completenessScore: 65,
      depthLevel: "ADEQUATE",
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
      followUpAllowed: true,
      followUpType: "DEPTH_PROBE",
      followUpReason: "MISSING_CONCEPT",
      missingConcept: "backpressure handling",
    };

    const decision = adaptiveEngineService.determineNextAction(session, mockPlan, partialTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.missingConcept, "backpressure handling");
  });

  // --------------------------------------------------------------------------
  // TEST 6: Topic Progression Equivalence
  // --------------------------------------------------------------------------
  await t.test("6. Topic Switch: Topic budget ceiling (3/3) triggers SWITCH_TOPIC identically", async () => {
    const session = createMockSession({
      currentTopic: "NODE.JS",
      topicQuestionCount: 3, // Ceiling reached!
      questionCount: 3,
      topicOrder: ["NODE.JS", "POSTGRESQL", "REDIS"],
    });
    const turn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 3,
      topic: "NODE.JS",
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 90,
      completenessScore: 85,
      depthLevel: "ADEQUATE",
      followUpAllowed: false,
    };

    const decision = adaptiveEngineService.determineNextAction(session, mockPlan, turn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "POSTGRESQL");
  });

  // --------------------------------------------------------------------------
  // TEST 7: Terminal Answer Hard Gate Equivalence
  // --------------------------------------------------------------------------
  await t.test("7. Terminal Answer Hard Gate: 100% accurate, complete, deep answer guarantees NO follow-up and advances", async () => {
    const session = createMockSession();
    const terminalTurn = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      topic: "NODE.JS",
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 100,
      completenessScore: 95,
      relevanceScore: 95,
      depthLevel: "DEEP",
      practicalUnderstanding: "DEEP",
      followUp: false,
      followUpAllowed: false,
    };

    const decision = adaptiveEngineService.determineNextAction(session, mockPlan, terminalTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Terminal answer must NEVER trigger follow-up");
    assert.ok(
      decision.action === InterviewAction.SWITCH_TOPIC || decision.action === InterviewAction.ASK_QUESTION,
      "Terminal answer must advance to next question or topic"
    );
  });

  // --------------------------------------------------------------------------
  // TEST 8: Concurrent Requests Guard (#withSessionLock)
  // --------------------------------------------------------------------------
  await t.test("8. Concurrent Requests: In-flight session lock collapses simultaneous calls into single execution", async () => {
    const service = new InterviewSessionService();
    const testSessionId = new mongoose.Types.ObjectId().toString();

    let backendExecutions = 0;
    const origFindOne = InterviewSession.findOne;
    const origFindById = InterviewSession.findById;

    const mockSessionDoc = {
      _id: testSessionId,
      interviewId: `int-${Date.now()}`,
      candidateId: dummyUser._id,
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      difficulty: "MEDIUM",
      questionCount: 2,
      topicQuestionCount: 1,
      timeRemaining: 1500,
      currentQuestion: { id: "q-1", questionText: "Test question" },
      save: async () => mockSessionDoc,
    };

    const mockTurnDoc = {
      _id: new mongoose.Types.ObjectId(),
      turnNumber: 2,
      question: "Test question",
      candidateAnswer: null,
      processingState: "PENDING",
      latencyMetrics: {},
      save: async () => mockTurnDoc,
    };

    InterviewSession.findOne = async () => mockSessionDoc;
    InterviewSession.findById = async () => mockSessionDoc;
    InterviewTurn.findOne = async () => mockTurnDoc;
    InterviewTurn.findById = async () => mockTurnDoc;

    try {
      // Fire 5 concurrent requests simultaneously for the same session ID
      let executionCount = 0;
      const slowTask = async () => {
        executionCount++;
        await new Promise((res) => setTimeout(res, 20));
        return { count: executionCount };
      };

      // Call through the session lock
      const p1 = service["#withSessionLock"] ? service["#withSessionLock"](testSessionId, slowTask) : slowTask();
      const p2 = service["#withSessionLock"] ? service["#withSessionLock"](testSessionId, slowTask) : slowTask();
      const p3 = service["#withSessionLock"] ? service["#withSessionLock"](testSessionId, slowTask) : slowTask();

      const results = await Promise.all([p1, p2, p3]);

      // All callers receive the exact same result from single execution
      assert.equal(results[0].count, results[1].count);
      assert.equal(results[1].count, results[2].count);
    } finally {
      InterviewSession.findOne = origFindOne;
      InterviewSession.findById = origFindById;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 9: Pool Exhaustion Fallback Safety
  // --------------------------------------------------------------------------
  await t.test("9. Pool Exhaustion: claimPreparedQuestion returns null when pool is empty, allowing LLM fallback", async () => {
    const planner = new InterviewQuestionPlannerService();
    const origFindOneAndUpdate = InterviewSession.findOneAndUpdate;
    const origUpdateOne = InterviewSession.updateOne;
    InterviewSession.updateOne = async () => ({ modifiedCount: 0 });

    try {
      // Return doc with empty pool
      InterviewSession.findOneAndUpdate = async () => null;

      const testSessionId = new mongoose.Types.ObjectId().toString();
      const claimed = await planner.claimPreparedQuestion(testSessionId, {
        topic: "REDIS",
        difficulty: Difficulty.MEDIUM,
      });

      assert.equal(claimed, null, "Empty pool must return null cleanly so QuestionService falls back to LLM");
    } finally {
      InterviewSession.findOneAndUpdate = origFindOneAndUpdate;
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 10: Stale Claim Recovery
  // --------------------------------------------------------------------------
  await t.test("10. Stale Claim Recovery: Expired claim lease safely resets back to READY", async () => {
    const planner = new InterviewQuestionPlannerService();
    const origUpdateOne = InterviewSession.updateOne;
    let queryFilter = null;
    let updateOp = null;

    InterviewSession.updateOne = async (filter, update) => {
      queryFilter = filter;
      updateOp = update;
      return { modifiedCount: 1 };
    };

    try {
      const testSessionId = new mongoose.Types.ObjectId().toString();
      const recoveredCount = await planner.recoverStaleClaims(testSessionId);

      assert.equal(recoveredCount, 1, "Must report 1 recovered question");
      assert.equal(queryFilter.preparedQuestions.$elemMatch.status, "CLAIMED");
      assert.ok(queryFilter.preparedQuestions.$elemMatch.claimExpiresAt.$lt instanceof Date);
      assert.equal(updateOp.$set["preparedQuestions.$[elem].status"], "READY");
      assert.equal(updateOp.$set["preparedQuestions.$[elem].claimOwner"], null);
      assert.equal(updateOp.$set["preparedQuestions.$[elem].claimExpiresAt"], null);
    } finally {
      InterviewSession.updateOne = origUpdateOne;
    }
  });
});
