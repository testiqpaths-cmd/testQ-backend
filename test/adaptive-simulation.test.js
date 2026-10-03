import test from "node:test";
import assert from "node:assert/strict";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { answerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";

test("Adaptive Engine - Conversational & Authoritative Simulation Suite", async (t) => {
  const engine = new AdaptiveEngineService();

  await t.test("Scenario 1: Fast Candidate - High scores, rapid answering reaches >10 questions without early termination", () => {
    // 30 minute interview (1800s). Candidate takes 40s per question, scores 90+.
    // Old system would have terminated at question 9 (round(30/3.5)).
    const plan = {
      globalQuestionLimit: 25,
      maxQuestionsPerTopic: 4,
      maxFollowUpsPerQuestion: 3,
      maxGlobalFollowUps: 8,
      adaptivePacing: {
        targetMinQuestions: 6,
        targetMaxQuestions: 25,
        wrapUpBufferSec: 120,
      },
      topicBudgets: {
        SYSTEM_DESIGN: 4,
        NODEJS: 4,
        DATABASES: 4,
        NETWORKING: 4,
      },
    };

    let session = {
      interviewId: "sim-fast-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODEJS",
      questionCount: 9, // Exactly turn 9 where old system hard-stopped
      topicQuestionCount: 2,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 1440, // 24 minutes left!
      wrapUpStarted: false,
      topicOrder: ["NODEJS", "DATABASES", "SYSTEM_DESIGN", "NETWORKING"],
      candidatePerformance: {
        runningAccuracy: 92,
        streakCorrect: 3,
        streakGaps: 0,
        consecutiveKnowledgeGapsInTopic: 0,
      },
      coverageState: [
        { topic: "NODEJS", questionsAsked: 2, status: "IN_PROGRESS" },
        { topic: "DATABASES", questionsAsked: 0, status: "PENDING" },
      ],
    };

    const lastTurn = {
      turnNumber: 9,
      topic: "NODEJS",
      difficulty: Difficulty.MEDIUM,
      cognitiveDepth: "IMPLEMENTATION",
      correctnessScore: 90,
      answerStatus: AnswerStatus.ACCURATE,
      candidateAnswer: "Node.js uses libuv thread pool for async I/O operations with non-blocking event loop.",
      conceptsMissing: [],
      followUp: false,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);

    // Old formula would have completed here. New engine MUST continue interview!
    assert.notEqual(decision.action, InterviewAction.COMPLETE_INTERVIEW, "Interview must NOT terminate at Q9 when 24 minutes remain");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
    assert.equal(decision.topic, "NODEJS");
    // Cognitive depth escalates towards TRADEOFF/ARCHITECTURE
    assert.ok(["TRADEOFF", "ARCHITECTURE"].includes(decision.cognitiveDepth), `Depth should scale up, got ${decision.cognitiveDepth}`);
  });

  await t.test("Scenario 2: Deep Candidate - High scores with detailed architecture answers concludes gracefully", () => {
    // 30 minute interview. Candidate takes 200s per question with deep architecture responses.
    // Question count is lower (7 questions), time remaining drops into wrap-up buffer (<= 120s).
    const plan = {
      adaptivePacing: {
        targetMinQuestions: 6,
        targetMaxQuestions: 25,
        wrapUpBufferSec: 120,
      },
      maxQuestionsPerTopic: 3,
      maxFollowUpsPerQuestion: 3,
      maxGlobalFollowUps: 8,
    };

    const session = {
      interviewId: "sim-deep-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "SYSTEM_DESIGN",
      questionCount: 7,
      topicQuestionCount: 3,
      followUpCount: 1,
      globalFollowUpCount: 2,
      timeRemaining: 110, // Under 120s wrap-up buffer!
      wrapUpStarted: false,
      topicOrder: ["NODEJS", "DATABASES", "SYSTEM_DESIGN"],
      candidatePerformance: {
        runningAccuracy: 95,
        streakCorrect: 4,
        consecutiveKnowledgeGapsInTopic: 0,
      },
    };

    const lastTurn = {
      turnNumber: 7,
      topic: "SYSTEM_DESIGN",
      difficulty: Difficulty.HARD,
      cognitiveDepth: "ARCHITECTURE",
      correctnessScore: 95,
      answerStatus: AnswerStatus.ACCURATE,
      candidateAnswer: "We shard by customer_id using consistent hashing with virtual nodes and Raft consensus.",
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);

    // Must trigger wrap-up phase rather than an abrupt cutoff or asking a heavy new architecture question
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
    assert.equal(decision.isWrapUp, true);
    assert.equal(decision.adaptiveAction, "WRAP_UP_INTERVIEW");
    assert.equal(decision.difficulty, Difficulty.EASY);
  });

  await t.test("Scenario 3: 50% Candidate - Partial answer triggers same-topic follow-up probing missing concepts", () => {
    const plan = {
      adaptivePacing: { targetMinQuestions: 6, targetMaxQuestions: 25, wrapUpBufferSec: 120 },
      maxQuestionsPerTopic: 4,
      maxFollowUpsPerQuestion: 3,
      maxGlobalFollowUps: 8,
    };

    const session = {
      interviewId: "sim-partial-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DATABASES",
      questionCount: 3,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 1200,
      wrapUpStarted: false,
      topicOrder: ["DATABASES", "SYSTEM_DESIGN"],
      candidatePerformance: { runningAccuracy: 55, streakCorrect: 0, consecutiveKnowledgeGapsInTopic: 0 },
    };

    const lastTurn = {
      turnNumber: 3,
      topic: "DATABASES",
      difficulty: Difficulty.MEDIUM,
      cognitiveDepth: "DEFINITION",
      correctnessScore: 55,
      answerStatus: AnswerStatus.PARTIAL,
      candidateAnswer: "Indexes make queries faster by ordering data, but write operations might be a bit slower.",
      conceptsMissing: ["B-Tree structure", "Write amplification / index maintenance overhead"],
      followUp: true,
      followUpDepth: 0,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);

    assert.equal(decision.action, InterviewAction.FOLLOW_UP, "Partial answer with missing concepts should follow up");
    assert.equal(decision.topic, "DATABASES");
    assert.equal(decision.followUpDepth, 1);
  });

  await t.test("Scenario 4: 20% Candidate - Prerequisite recovery and graceful topic switch on repeated gaps", () => {
    const plan = {
      adaptivePacing: { targetMinQuestions: 6, targetMaxQuestions: 25, wrapUpBufferSec: 120 },
      maxQuestionsPerTopic: 3,
      maxFollowUpsPerQuestion: 3,
      maxGlobalFollowUps: 8,
    };

    // Sub-case 4A: First gap drops cognitive depth to PREREQUISITE
    const session4A = {
      interviewId: "sim-struggle-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NETWORKING",
      questionCount: 2,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 1400,
      wrapUpStarted: false,
      topicOrder: ["NETWORKING", "DATABASES", "REACT"],
      candidatePerformance: { runningAccuracy: 25, streakCorrect: 0, consecutiveKnowledgeGapsInTopic: 1 },
      coverageState: [{ topic: "NETWORKING", questionsAsked: 1 }],
    };

    const lastTurn4A = {
      turnNumber: 2,
      topic: "NETWORKING",
      difficulty: Difficulty.MEDIUM,
      cognitiveDepth: "DEFINITION",
      correctnessScore: 20,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      candidateAnswer: "I don't know how TCP three-way handshake works.",
      followUp: false,
    };

    const decision4A = engine.determineNextAction(session4A, plan, lastTurn4A);
    assert.equal(decision4A.action, InterviewAction.ASK_QUESTION);
    assert.equal(decision4A.difficulty, Difficulty.EASY, "Difficulty should step down to EASY");
    assert.equal(decision4A.cognitiveDepth, "PREREQUISITE", "Cognitive depth should step down to PREREQUISITE for recovery");

    // Sub-case 4B: Second consecutive gap switches topic gracefully
    const session4B = {
      ...session4A,
      questionCount: 3,
      topicQuestionCount: 2,
      candidatePerformance: { runningAccuracy: 20, streakCorrect: 0, consecutiveKnowledgeGapsInTopic: 2 },
    };

    const lastTurn4B = {
      turnNumber: 3,
      topic: "NETWORKING",
      difficulty: Difficulty.EASY,
      cognitiveDepth: "PREREQUISITE",
      correctnessScore: 15,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      candidateAnswer: "I don't know.",
    };

    const decision4B = engine.determineNextAction(session4B, plan, lastTurn4B);
    assert.equal(decision4B.action, InterviewAction.SWITCH_TOPIC, "Two consecutive gaps must trigger graceful topic switch");
    assert.equal(decision4B.nextTopic, "DATABASES");
  });

  await t.test("Scenario 5: 100% Candidate - Monotonic cognitive depth progression (Definition -> Implementation -> Tradeoff -> Architecture)", () => {
    // Test cognitive depth ladder progression
    const d1 = engine.determineNextDepth({
      currentDepth: "DEFINITION",
      correctnessScore: 95,
      answerStatus: AnswerStatus.ACCURATE,
      conceptsMissing: [],
      misconceptions: [],
    });
    assert.equal(d1, "IMPLEMENTATION", "95% on DEFINITION escalates to IMPLEMENTATION");

    const d2 = engine.determineNextDepth({
      currentDepth: "IMPLEMENTATION",
      correctnessScore: 95,
      answerStatus: AnswerStatus.ACCURATE,
      conceptsMissing: [],
      misconceptions: [],
    });
    assert.equal(d2, "TRADEOFF", "95% on IMPLEMENTATION escalates to TRADEOFF");

    const d3 = engine.determineNextDepth({
      currentDepth: "TRADEOFF",
      correctnessScore: 95,
      answerStatus: AnswerStatus.ACCURATE,
      conceptsMissing: [],
      misconceptions: [],
    });
    assert.equal(d3, "ARCHITECTURE", "95% on TRADEOFF escalates to ARCHITECTURE");
  });

  await t.test("Scenario 6: Conversational Knowledge Gap Discrimination - Semantic statements are NOT zeroed", () => {
    // Pure non-answers must be flagged as explicit knowledge gaps
    assert.equal(answerAnalysisService.isExplicitKnowledgeGap("I don't know"), true);
    assert.equal(answerAnalysisService.isExplicitKnowledgeGap("No idea"), true);
    assert.equal(answerAnalysisService.isExplicitKnowledgeGap("Not sure, pass"), true);

    // Conversational statements with contrasts must NEVER be classified as pure knowledge gaps
    const conversationalAnswer1 = "I haven't used Kafka in production, but I have worked extensively with RabbitMQ and event-driven architectures.";
    assert.equal(
      answerAnalysisService.isExplicitKnowledgeGap(conversationalAnswer1),
      false,
      "Conversational answer contrasting experience must NOT be marked as knowledge gap"
    );

    const conversationalAnswer2 = "I'm not familiar with GraphQL internals, however in REST APIs we implemented DataLoader-style batching to resolve N+1 queries.";
    assert.equal(
      answerAnalysisService.isExplicitKnowledgeGap(conversationalAnswer2),
      false,
      "Substantive answer with contrasting clause must NOT be marked as knowledge gap"
    );
  });

  await t.test("Scenario 7: Multi-turn Follow-up Chain - Depth 1 -> 2 -> 3 then topic progression", () => {
    const plan = {
      adaptivePacing: { targetMinQuestions: 6, targetMaxQuestions: 25, wrapUpBufferSec: 120 },
      maxQuestionsPerTopic: 5,
      maxFollowUpsPerQuestion: 3,
      maxGlobalFollowUps: 10,
    };

    // Thread depth 1 -> Follow up to depth 2
    const sessionDepth1 = {
      interviewId: "sim-chain-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DISTRIBUTED_SYSTEMS",
      questionCount: 2,
      topicQuestionCount: 1,
      followUpCount: 1,
      globalFollowUpCount: 1,
      timeRemaining: 1000,
      wrapUpStarted: false,
      topicOrder: ["DISTRIBUTED_SYSTEMS", "SECURITY"],
      candidatePerformance: { runningAccuracy: 60, streakCorrect: 0, consecutiveKnowledgeGapsInTopic: 0 },
    };

    const turnDepth1 = {
      turnNumber: 3,
      topic: "DISTRIBUTED_SYSTEMS",
      cognitiveDepth: "IMPLEMENTATION",
      correctnessScore: 65,
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
      followUpDepth: 1,
      parentTurnId: "turn-1",
      conceptsMissing: ["split-brain mitigation"],
    };

    const decisionDepth2 = engine.determineNextAction(sessionDepth1, plan, turnDepth1);
    assert.equal(decisionDepth2.action, InterviewAction.FOLLOW_UP);
    assert.equal(decisionDepth2.followUpDepth, 2, "Follow-up chain advances to depth 2");

    // Thread depth 2 -> Follow up to depth 3
    const turnDepth2 = {
      ...turnDepth1,
      turnNumber: 4,
      followUpDepth: 2,
      correctnessScore: 70,
      conceptsMissing: ["fencing tokens"],
    };

    const decisionDepth3 = engine.determineNextAction(sessionDepth1, plan, turnDepth2);
    assert.equal(decisionDepth3.action, InterviewAction.FOLLOW_UP);
    assert.equal(decisionDepth3.followUpDepth, 3, "Follow-up chain advances to depth 3");

    // Thread depth 3 -> Thread capped at maxFollowUpsPerQuestion (3), must move on to next question
    const turnDepth3 = {
      ...turnDepth1,
      turnNumber: 5,
      followUpDepth: 3,
      correctnessScore: 75,
      conceptsMissing: [],
    };

    const decisionCap = engine.determineNextAction(sessionDepth1, plan, turnDepth3);
    assert.notEqual(decisionCap.action, InterviewAction.FOLLOW_UP, "Chain at depth 3 must NOT allow 4th follow-up");
    assert.equal(decisionCap.action, InterviewAction.ASK_QUESTION, "Chain moves to next regular question");
  });

  await t.test("Scenario 8: Pacing Calculation - Expected response time and watchdog scale by cognitive depth", () => {
    const pacingDef = engine.calculatePacing("DEFINITION");
    assert.equal(pacingDef.expectedResponseSec, 60);
    assert.equal(pacingDef.inactivityWatchdogSec, 40);

    const pacingArch = engine.calculatePacing("ARCHITECTURE");
    assert.equal(pacingArch.expectedResponseSec, 180);
    assert.equal(pacingArch.inactivityWatchdogSec, 90);

    const pacingPrereq = engine.calculatePacing("PREREQUISITE");
    assert.equal(pacingPrereq.expectedResponseSec, 45);
    assert.equal(pacingPrereq.inactivityWatchdogSec, 40);
  });
});
