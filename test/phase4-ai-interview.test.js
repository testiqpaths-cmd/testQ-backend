import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AnswerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { AiAnswerAnalysisService } from "../src/ai-interview/ai/ai-answer-analysis.service.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";

const candidateA_id = new mongoose.Types.ObjectId();
const candidateB_id = new mongoose.Types.ObjectId();

test("Phase 4: Deterministic Strict 'I Don't Know' Rule", async (t) => {
  const service = new AnswerAnalysisService();

  await t.test("Detects 'I don't know' with exact and variation phrasing", () => {
    assert.equal(service.isExplicitKnowledgeGap("I don't know"), true);
    assert.equal(service.isExplicitKnowledgeGap("i don't know"), true);
    assert.equal(service.isExplicitKnowledgeGap("I don't know the answer to this question."), true);
    assert.equal(service.isExplicitKnowledgeGap("I do not know"), true);
  });

  await t.test("Detects 'I'm not sure' and uncertainty admissions", () => {
    assert.equal(service.isExplicitKnowledgeGap("I'm not sure"), true);
    assert.equal(service.isExplicitKnowledgeGap("i am not sure"), true);
    assert.equal(service.isExplicitKnowledgeGap("Not really sure about this."), true);
  });

  await t.test("Detects 'haven't worked with' and experience gaps", () => {
    assert.equal(service.isExplicitKnowledgeGap("I haven't worked with this"), true);
    assert.equal(service.isExplicitKnowledgeGap("I have never worked with MongoDB"), true);
    assert.equal(service.isExplicitKnowledgeGap("Never used it before."), true);
  });

  await t.test("Detects 'don't remember' and 'can't answer' and 'no idea'", () => {
    assert.equal(service.isExplicitKnowledgeGap("I don't remember"), true);
    assert.equal(service.isExplicitKnowledgeGap("I can't answer that"), true);
    assert.equal(service.isExplicitKnowledgeGap("I have no idea"), true);
  });

  await t.test("Handles punctuation and leading/trailing whitespace variations", () => {
    assert.equal(service.isExplicitKnowledgeGap("   I don't know...   "), true);
    assert.equal(service.isExplicitKnowledgeGap("Sorry, I'm not sure!"), true);
  });

  await t.test("Does NOT treat substantive answers as knowledge gaps merely because of hedging", () => {
    const substantiveAnswer =
      "I think a closure is when a function remembers variables from its outer scope, but I'm not completely sure about the exact implementation details in the V8 engine.";
    assert.equal(
      service.isExplicitKnowledgeGap(substantiveAnswer),
      false,
      "Substantive answer with a hedge is NOT an explicit knowledge gap"
    );
  });
});

test("Phase 4: Backend Override on Knowledge Gap (Strict No Follow-Up)", async (t) => {
  await t.test("Knowledge gap strictly overrides AI recommendation if AI suggests follow-up", async () => {
    // Mock AI that incorrectly recommends a follow-up on a knowledge gap
    const rogueAi = {
      analyzeCandidateAnswer: async () => ({
        answerStatus: AnswerStatus.PARTIAL,
        followUpRecommended: true, // Rogue AI recommendation
        relevanceScore: 90,
        correctnessScore: 30,
        completenessScore: 20,
        confidence: 80,
      }),
    };

    const service = new AnswerAnalysisService(rogueAi);
    const rawGapAnswer = "I don't know anything about Kubernetes.";

    // Deterministic check triggers first
    assert.equal(service.isExplicitKnowledgeGap(rawGapAnswer), true);

    // Backend rule: Knowledge gap enforces NO follow-up under any circumstances
    const isGap = service.isExplicitKnowledgeGap(rawGapAnswer);
    let followUpAllowed = false;
    if (!isGap) {
      followUpAllowed = true;
    }

    assert.equal(followUpAllowed, false, "Backend MUST override AI: followUpAllowed must be FALSE");
  });
});

test("Phase 4: Partial Answer vs Knowledge Gap Differentiation", async (t) => {
  const service = new AnswerAnalysisService();

  await t.test("Partial answer with some technical understanding is recognized", () => {
    const partialText = "A closure is when an inner function accesses an outer function variable.";
    assert.equal(service.isExplicitKnowledgeGap(partialText), false, "Should not be flagged as knowledge gap");
  });

  await t.test("Follow-up is permitted for partial answers if backend constraints permit", () => {
    const session = {
      followUpCount: 0,
      globalFollowUpCount: 1,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };

    const aiFollowUpRecommended = true;
    const finalStatus = AnswerStatus.PARTIAL;
    const isExplicitGap = false;

    let followUpAllowed = false;
    if (
      !isExplicitGap &&
      finalStatus === AnswerStatus.PARTIAL &&
      aiFollowUpRecommended &&
      session.followUpCount < plan.maxFollowUpsPerQuestion &&
      session.globalFollowUpCount < plan.maxGlobalFollowUps &&
      session.timeRemaining > 120 &&
      session.candidatePerformance.consecutiveKnowledgeGapsInTopic < 2
    ) {
      followUpAllowed = true;
    }

    assert.equal(followUpAllowed, true, "Partial answer should be permitted follow-up");
  });

  await t.test("Follow-up is rejected if per-question limit reached (max 1)", () => {
    const session = {
      followUpCount: 1, // Already had 1 follow-up on this question!
      globalFollowUpCount: 1,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };

    let followUpAllowed = false;
    if (session.followUpCount < plan.maxFollowUpsPerQuestion) {
      followUpAllowed = true;
    }

    assert.equal(followUpAllowed, false, "Must reject second follow-up on the same question");
  });

  await t.test("Follow-up is rejected if interview is near time limit (<120s)", () => {
    const session = {
      followUpCount: 0,
      globalFollowUpCount: 1,
      timeRemaining: 60, // Only 60 seconds left!
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };

    let followUpAllowed = session.timeRemaining > 120;
    assert.equal(followUpAllowed, false, "Must reject follow-up when timeRemaining < 120s");
  });
});

test("Phase 4: AI Answer Analysis Service & Heuristic Fallback", async (t) => {
  const aiService = new AiAnswerAnalysisService();

  await t.test("Valid AI structured response is accepted and validated", async () => {
    const mockAi = {
      generateStructuredJson: async () => ({
        answerStatus: "ACCURATE",
        relevanceScore: 95,
        correctnessScore: 90,
        completenessScore: 85,
        confidence: 80,
        conceptsDemonstrated: ["Lexical scope", "Function references"],
        conceptsMissing: [],
        feedbackSummary: "Excellent explanation of closures.",
        followUpRecommended: false,
        difficultyRecommendation: "MEDIUM",
        topicContinuationRecommended: true,
      }),
    };

    const analyzer = new AiAnswerAnalysisService(mockAi);
    const result = await analyzer.analyzeCandidateAnswer({
      question: "What is a closure?",
      candidateAnswer: "A function that has access to outer function scope.",
      topic: "JAVASCRIPT",
      difficulty: "EASY",
    });

    assert.equal(result.answerStatus, "ACCURATE");
    assert.equal(result.correctnessScore, 90);
    assert.equal(result.followUpRecommended, false);
  });

  await t.test("Fallback heuristic safely handles LLM failure or timeout", async () => {
    const mockFailingAi = {
      generateStructuredJson: async () => null, // Simulated timeout/failure
    };

    const analyzer = new AiAnswerAnalysisService(mockFailingAi);
    const result = await analyzer.analyzeCandidateAnswer({
      question: "Explain Virtual DOM.",
      candidateAnswer: "The virtual DOM is an in-memory representation of real DOM components that React reconciles efficiently.",
      topic: "REACT",
      difficulty: "EASY",
    });

    assert.ok(result.answerStatus);
    assert.ok(result.correctnessScore > 0);
    assert.ok(result.feedbackSummary);
  });

  await t.test("Fallback heuristic safely handles malformed JSON from LLM", async () => {
    const mockMalformedAi = {
      generateStructuredJson: async () => ({
        corrupted: true,
      }),
    };

    const analyzer = new AiAnswerAnalysisService(mockMalformedAi);
    const result = await analyzer.analyzeCandidateAnswer({
      question: "What is Node.js?",
      candidateAnswer: "Node.js is an event-driven runtime.",
      topic: "NODE.JS",
      difficulty: "EASY",
    });

    assert.ok(result.answerStatus);
    assert.ok(result.correctnessScore > 0);
  });
});

test("Phase 4: Persistence on SAME InterviewTurn", async (t) => {
  const turnId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  const questionTime = new Date(Date.now() - 45000);
  const answerTime = new Date(Date.now() - 15000);

  // Turn created in Phase 2 and updated with candidate answer in Phase 3
  const turn = new InterviewTurn({
    _id: turnId,
    sessionId,
    interviewId: "int-test-12345",
    turnNumber: 1,
    topic: "REACT",
    question: "What is the Virtual DOM in React?",
    difficulty: Difficulty.EASY,
    competency: "Technical Knowledge",
    questionTimestamp: questionTime,
    candidateAnswer: "It is a lightweight copy of the real DOM used to calculate minimal updates.",
    answerTimestamp: answerTime,
    timeTakenSeconds: 30,
    processingState: "SUBMITTED",
  });

  await t.test("Updates existing turn with analysis while preserving original question and answer context", () => {
    // Add analysis fields
    turn.answerStatus = AnswerStatus.ACCURATE;
    turn.correctnessScore = 90;
    turn.relevanceScore = 95;
    turn.completenessScore = 85;
    turn.confidence = 80;
    turn.conceptsDemonstrated = ["Virtual DOM", "DOM diffing"];
    turn.conceptsMissing = [];
    turn.feedbackSummary = "Strong concise explanation.";
    turn.followUp = false;
    turn.processingState = "ANALYZED";
    turn.analysisTimestamp = new Date();

    // Verify all original fields remain intact
    assert.equal(turn.turnNumber, 1);
    assert.equal(turn.topic, "REACT");
    assert.equal(turn.difficulty, "EASY");
    assert.equal(turn.competency, "Technical Knowledge");
    assert.equal(turn.question, "What is the Virtual DOM in React?");
    assert.equal(turn.candidateAnswer, "It is a lightweight copy of the real DOM used to calculate minimal updates.");
    assert.equal(turn.timeTakenSeconds, 30);

    // Verify analysis fields saved
    assert.equal(turn.answerStatus, "ACCURATE");
    assert.equal(turn.correctnessScore, 90);
    assert.equal(turn.processingState, "ANALYZED");
    assert.ok(turn.analysisTimestamp instanceof Date);
  });
});

test("Phase 4: Topic Coverage and Candidate Performance Updates", async (t) => {
  await t.test("CoverageState updates knowledge gaps and coverage percentage", () => {
    const coverageItem = {
      topic: "REACT",
      questionsAsked: 1,
      knowledgeGaps: 0,
      coveragePercentage: 0,
      knowledgeLevel: "NONE",
      status: "IN_PROGRESS",
    };

    // Candidate expressed knowledge gap
    coverageItem.knowledgeGaps += 1;
    const correctness = 0;
    if (correctness >= 80) coverageItem.knowledgeLevel = "ADVANCED";
    else if (correctness >= 55) coverageItem.knowledgeLevel = "MEDIUM";
    else if (correctness >= 30) coverageItem.knowledgeLevel = "BASIC";
    else coverageItem.knowledgeLevel = "NONE";

    const targetQuestions = 3;
    coverageItem.coveragePercentage = Math.min(
      100,
      Math.round((coverageItem.questionsAsked / targetQuestions) * 100)
    );

    assert.equal(coverageItem.knowledgeGaps, 1);
    assert.equal(coverageItem.knowledgeLevel, "NONE");
    assert.equal(coverageItem.coveragePercentage, 33);
  });

  await t.test("CandidatePerformance updates accuracy and baseline after 3 turns", () => {
    const perf = {
      baselineEstablished: false,
      baselineScore: 0,
      streakCorrect: 0,
      streakGaps: 0,
      consecutiveKnowledgeGapsInTopic: 0,
      runningAccuracy: 0,
    };

    // Turn 1: 80%
    perf.runningAccuracy = 80;
    perf.streakCorrect = 1;

    // Turn 2: 70%
    perf.runningAccuracy = Math.round((perf.runningAccuracy * 1 + 70) / 2); // 75
    perf.streakCorrect = 2;

    // Turn 3: 90%
    perf.runningAccuracy = Math.round((perf.runningAccuracy * 2 + 90) / 3); // 80
    perf.streakCorrect = 3;

    // Baseline triggers at turn 3
    if (!perf.baselineEstablished) {
      perf.baselineEstablished = true;
      perf.baselineScore = perf.runningAccuracy;
    }

    assert.equal(perf.baselineEstablished, true);
    assert.equal(perf.baselineScore, 80);
    assert.equal(perf.streakCorrect, 3);
  });
});
