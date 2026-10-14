import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { AiAnswerAnalysisService } from "../src/ai-interview/ai/ai-answer-analysis.service.js";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";

test("Cross-Questioning Quality Tiers & Candidate Response Evaluation Logic", async (t) => {
  const engine = new AdaptiveEngineService();
  const aiAnswerAnalysis = new AiAnswerAnalysisService();

  const plan = {
    globalQuestionLimit: 10,
    maxQuestionsPerTopic: 4,
    maxFollowUpsPerTopic: 3,
    maxFollowUpsPerQuestion: 3,
    maxGlobalFollowUps: 4,
  };

  const createBaseSession = (topic = "REDIS") => ({
    interviewId: "int-tier-test",
    interviewState: InterviewState.IN_PROGRESS,
    currentTopic: topic,
    questionCount: 1,
    topicQuestionCount: 1,
    followUpCount: 0,
    topicFollowUpCount: 0,
    globalFollowUpCount: 0,
    timeRemaining: 800,
    candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    topicOrder: [topic, "SYSTEM_DESIGN"],
    coverageState: [{ topic, questionsAsked: 1, depthEstablished: false, followupsAsked: 0 }],
  });

  // --------------------------------------------------------------------------
  // TIER 1: 90–100% + complete -> ❌ No cross-question -> Accept answer and advance
  // --------------------------------------------------------------------------
  await t.test("Tier 1: 90–100% complete and accurate answer does NOT trigger cross-question", () => {
    const session = createBaseSession("REDIS");
    const turn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 95,
      completenessScore: 92,
      depthLevel: "ADEQUATE",
      depthEstablished: false,
      followUpRecommended: false,
      followUpAllowed: false,
      conceptsMissing: [],
      concept: "Redis persistence mechanics",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.notEqual(
      decision.action,
      InterviewAction.FOLLOW_UP,
      "Genuinely complete and accurate answer MUST NOT trigger a cross-question"
    );
    assert.equal(
      decision.action,
      InterviewAction.ASK_QUESTION,
      "Should accept answer and advance to next primary question"
    );
    assert.equal(decision.decisionAudit.reason, "COMPLETE_ANSWER_ACCEPTED");
    assert.equal(decision.decisionAudit.trigger, "COMPLETE_ANSWER_NO_FOLLOWUP");
  });

  // --------------------------------------------------------------------------
  // TERMINAL ANSWER HARD GATE: 100% accurate + complete + deep -> 🚫 NO FOLLOW-UP
  // --------------------------------------------------------------------------
  await t.test("Terminal Answer Hard Gate: 100% accurate, complete, deep answer guarantees NO follow-up", () => {
    const session = createBaseSession("REDIS");
    session.topicOrder = ["REDIS"]; // Single topic session: test within-topic question progression
    const terminalTurn = {
      difficulty: Difficulty.HARD,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 100,
      completenessScore: 100,
      relevanceScore: 100,
      depthLevel: "DEEP",
      depthEstablished: false,
      contradictionDetected: false,
      misconceptions: [],
      conceptsMissing: [],
      concept: "Redis persistence mechanics",
      followUpRecommended: true, // Even if mistakenly requested, hard gate must intercept!
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, plan, terminalTurn);
    assert.notEqual(
      decision.action,
      InterviewAction.FOLLOW_UP,
      "Terminal answer must be accepted without follow-up"
    );
    assert.ok(
      decision.action === InterviewAction.ASK_QUESTION ||
      decision.action === InterviewAction.SWITCH_TOPIC ||
      decision.action === InterviewAction.COMPLETE_INTERVIEW,
      "Must advance to next primary question, next topic, or complete interview"
    );
    assert.equal(decision.decisionAudit.followUpType, "NONE");
  });

  // --------------------------------------------------------------------------
  // INDEPENDENT DIMENSIONS: Correctness alone does NOT decide follow-up
  // --------------------------------------------------------------------------
  await t.test("Independent dimensions: Correctness 100 with Shallow depth vs Correctness 100 with Deep depth", () => {
    const session = createBaseSession("REDIS");

    // Case A: Correctness = 100, Completeness = 60, Depth = SHALLOW -> Follow-up is reasonable
    const shallowTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 100,
      completenessScore: 60,
      depthLevel: "SHALLOW",
      followUpAllowed: true,
      conceptsMissing: ["fsync durability trade-offs"],
      concept: "Redis persistence mechanics",
    };
    const decisionShallow = engine.determineNextAction(session, plan, shallowTurn);
    assert.equal(
      decisionShallow.action,
      InterviewAction.FOLLOW_UP,
      "Correct but shallow answer should trigger follow-up"
    );
    assert.equal(decisionShallow.followUpReason, "MISSING_CONCEPT");
    assert.equal(decisionShallow.missingConcept, "fsync durability trade-offs");

    // Case B: Correctness = 100, Completeness = 100, Depth = DEEP -> No follow-up
    const deepTurn = {
      difficulty: Difficulty.HARD,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 100,
      completenessScore: 100,
      relevanceScore: 100,
      depthLevel: "DEEP",
      contradictionDetected: false,
      misconceptions: [],
      conceptsMissing: [],
      concept: "Redis persistence mechanics",
    };
    const decisionDeep = engine.determineNextAction(session, plan, deepTurn);
    assert.notEqual(
      decisionDeep.action,
      InterviewAction.FOLLOW_UP,
      "Deep complete answer must NOT trigger follow-up"
    );
    assert.ok(
      decisionDeep.action === InterviewAction.ASK_QUESTION ||
      decisionDeep.action === InterviewAction.SWITCH_TOPIC,
      "Must advance without follow-up"
    );
  });

  // --------------------------------------------------------------------------
  // TIER 2: 80–90% -> ✅ Yes -> Ask 1 meaningful cross-question to validate depth
  // --------------------------------------------------------------------------
  await t.test("Tier 2: 80–90% answer triggers 1 meaningful cross-question to validate depth", () => {
    const session = createBaseSession("REDIS");
    const turn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 85,
      completenessScore: 78,
      depthLevel: "ADEQUATE",
      followUpAllowed: true,
      concept: "Redis caching strategies",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.HARD);
    assert.equal(decision.followUpType, "PRACTICAL");
    assert.equal(decision.followUpReason, "PRACTICAL_DEPTH");
    assert.equal(decision.decisionAudit.trigger, "STRONG_PRACTICAL_PROBE");
  });

  await t.test("Tier 2 Limit: 80–90% answer does NOT trigger a SECOND cross-question (capped at 1)", () => {
    const session = createBaseSession("REDIS");
    session.followUpCount = 1; // Already asked 1 cross-question!

    const turn = {
      isFollowUp: true,
      difficulty: Difficulty.HARD,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 85,
      completenessScore: 80,
      depthLevel: "ADEQUATE",
      followUpAllowed: false,
      concept: "Redis caching strategies",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.notEqual(
      decision.action,
      InterviewAction.FOLLOW_UP,
      "80-90% answer should NOT ask multiple cross-questions; 1 was already asked"
    );
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
  });

  // --------------------------------------------------------------------------
  // TIER 3: 60–80% -> ✅ Yes -> Ask follow-up/cross-question
  // --------------------------------------------------------------------------
  await t.test("Tier 3: 60–80% answer triggers depth probe follow-up", () => {
    const session = createBaseSession("REDIS");
    const turn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 72,
      completenessScore: 65,
      depthLevel: "SHALLOW",
      knowledgeLevel: "INTERMEDIATE",
      followUpAllowed: true,
      conceptsMissing: ["AOF fsync policies"],
      concept: "Redis persistence",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.MEDIUM);
    assert.equal(decision.followUpType, "DEPTH_PROBE");
    assert.equal(decision.followUpReason, "MISSING_CONCEPT");
    assert.equal(decision.missingConcept, "AOF fsync policies");
  });

  // --------------------------------------------------------------------------
  // TIER 4: 40–60% -> ✅ Yes -> Clarify fundamentals, then reassess
  // --------------------------------------------------------------------------
  await t.test("Tier 4: 40–60% answer triggers clarification of fundamentals", () => {
    const session = createBaseSession("REDIS");
    const turn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 50,
      completenessScore: 45,
      depthLevel: "SHALLOW",
      knowledgeLevel: "BASIC",
      followUpAllowed: true,
      concept: "Redis data structures",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.EASY);
    assert.equal(decision.followUpType, "CLARIFICATION");
    assert.equal(decision.followUpReason, "CLARIFICATION");
    assert.equal(decision.decisionAudit.trigger, "WEAK_BASIC_ANSWER");
  });

  // --------------------------------------------------------------------------
  // TIER 5: <40% -> ❌ Usually no -> Don't waste multiple cross-questions
  // --------------------------------------------------------------------------
  await t.test("Tier 5: <40% answer does NOT waste repeated cross-questions", () => {
    const session = createBaseSession("REDIS");
    session.followUpCount = 1; // Already probed once!

    const turn = {
      isFollowUp: true,
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.INCORRECT,
      correctnessScore: 25,
      completenessScore: 20,
      depthLevel: "SHALLOW",
      knowledgeLevel: "BASIC",
      followUpRecommended: false,
      concept: "Redis cluster partitioning",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.notEqual(
      decision.action,
      InterviewAction.FOLLOW_UP,
      "Weak answer <40% must NOT waste multiple cross-questions"
    );
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
  });

  // --------------------------------------------------------------------------
  // TIER 6: Correct but shallow -> ✅ Yes -> Cross-question for practical depth
  // --------------------------------------------------------------------------
  await t.test("Tier 6: Correct but shallow triggers validation cross-question", () => {
    const session = createBaseSession("REDIS");
    const turn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 92,
      completenessScore: 55, // High correctness, but low completeness
      depthLevel: "SHALLOW", // Shallow textbook definition
      followUpType: "VALIDATION",
      followUpAllowed: true,
      concept: "Redis eviction policies",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpType, "VALIDATION");
    assert.equal(decision.difficulty, Difficulty.HARD);
    assert.equal(decision.followUpReason, "SHALLOW_ANSWER");
  });

  // --------------------------------------------------------------------------
  // TIER 7: Correct but missing detail -> ✅ Yes -> Follow up on missing detail
  // --------------------------------------------------------------------------
  await t.test("Tier 7: Correct but missing important detail triggers targeted detail probe", () => {
    const session = createBaseSession("REDIS");
    const turn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 82,
      completenessScore: 68,
      depthLevel: "ADEQUATE",
      conceptsDemonstrated: ["RDB snapshots"],
      conceptsMissing: ["AOF fsync tradeoffs"],
      followUpAllowed: true,
      concept: "Redis persistence",
    };

    const decision = engine.determineNextAction(session, plan, turn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpReason, "MISSING_CONCEPT");
    assert.equal(decision.missingConcept, "AOF fsync tradeoffs");
  });

  // --------------------------------------------------------------------------
  // EXPLICIT REASONING: Contradiction & Misconception follow-up reasons
  // --------------------------------------------------------------------------
  await t.test("Explicit follow-up reasons: Contradiction vs Misconception", () => {
    const session = createBaseSession("REDIS");

    // Contradiction
    const contradictionTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 60,
      contradictionDetected: true,
      misconceptions: ["Claimed Redis is single-threaded for background I/O"],
      followUpAllowed: true,
    };
    const decisionContra = engine.determineNextAction(session, plan, contradictionTurn);
    assert.equal(decisionContra.action, InterviewAction.FOLLOW_UP);
    assert.equal(decisionContra.followUpReason, "CONTRADICTION");

    // Misconception
    const misconceptionTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 60,
      contradictionDetected: false,
      misconceptions: ["Confused Redis Sentinel with Redis Cluster"],
      followUpAllowed: true,
    };
    const decisionMisc = engine.determineNextAction(session, plan, misconceptionTurn);
    assert.equal(decisionMisc.action, InterviewAction.FOLLOW_UP);
    assert.equal(decisionMisc.followUpReason, "MISCONCEPTION");
  });

  // --------------------------------------------------------------------------
  // TIER 8: Conservative Fallback Evaluation (No word-count factual guesswork)
  // --------------------------------------------------------------------------
  await t.test("Tier 8: Conservative Fallback when LLM is unavailable does not guess factual correctness", () => {
    // Test that short & wrong vs short & correct are NOT falsely given high factual scores based on word count
    const wrongAnswer = "Redis is a relational database with SQL support.";
    const analysisWrong = aiAnswerAnalysis.fallbackHeuristicAnalysis({
      question: "How does Redis handle persistence?",
      candidateAnswer: wrongAnswer,
      topic: "REDIS",
      difficulty: "MEDIUM",
    });

    assert.equal(analysisWrong.evaluationSource, "FALLBACK");
    assert.equal(analysisWrong.confidence, 20, "Must declare low confidence");
    assert.equal(analysisWrong.answerStatus, AnswerStatus.PARTIAL);
    assert.equal(analysisWrong.followUpRecommended, false, "Must not recommend aggressive follow-up");
    assert.equal(analysisWrong.followUpType, "NONE");

    const correctAnswer = "Redis is an in-memory key-value store.";
    const analysisCorrect = aiAnswerAnalysis.fallbackHeuristicAnalysis({
      question: "What is Redis?",
      candidateAnswer: correctAnswer,
      topic: "REDIS",
      difficulty: "MEDIUM",
    });

    assert.equal(analysisCorrect.evaluationSource, "FALLBACK");
    assert.equal(analysisCorrect.confidence, 20);
    assert.equal(analysisCorrect.followUpRecommended, false);

    // Ensure AdaptiveEngine does NOT make aggressive follow-up decisions when evaluationSource is FALLBACK
    const session = createBaseSession("REDIS");
    const fallbackTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 50,
      completenessScore: 50,
      depthLevel: "ADEQUATE",
      evaluationSource: "FALLBACK",
      followUpAllowed: false,
    };

    const decisionFallback = engine.determineNextAction(session, plan, fallbackTurn);
    assert.notEqual(
      decisionFallback.action,
      InterviewAction.FOLLOW_UP,
      "Fallback evaluations must NEVER trigger aggressive follow-up probing"
    );
    assert.equal(decisionFallback.action, InterviewAction.ASK_QUESTION);
  });
});
