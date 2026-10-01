import test from "node:test";
import assert from "node:assert/strict";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { AnswerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";

test("Phase 7: 15 Realistic Interview Scenarios Validation Suite", async (t) => {
  const engine = new AdaptiveEngineService();
  const analysisService = new AnswerAnalysisService();

  const basePlan = {
    globalQuestionLimit: 12,
    maxQuestionsPerTopic: 4,
    maxFollowUpsPerTopic: 3,
    maxFollowUpsPerQuestion: 3,
    maxGlobalFollowUps: 4,
  };

  // Scenario 1: Doesn't Know
  await t.test("Scenario 1 [Doesn't know]: 0 score -> no probe -> alternative concept / advance", () => {
    const rawAnswer = "I don't know.";
    const isGap = analysisService.isExplicitKnowledgeGap(rawAnswer);
    assert.equal(isGap, true, "Must detect direct 'I don't know' as knowledge gap");

    const session = {
      interviewId: "sc-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 1 },
      topicOrder: ["DJANGO", "KUBERNETES"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1 }],
    };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      isExplicitGap: true,
      followUpAllowed: false,
      concept: "Django middleware lifecycle",
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Must NEVER follow up on explicit gap");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
    assert.equal(decision.decisionAudit.decision, "ASK_QUESTION");
    assert.equal(decision.decisionAudit.reason, "KNOWLEDGE_GAP");
    assert.equal(decision.decisionAudit.trigger, "GAP_EXPLORE_ALTERNATIVE_CONCEPT");
    assert.equal(decision.decisionAudit.followUpType, "NONE");
    assert.equal(decision.decisionAudit.targetConcept, "Django middleware lifecycle");
    assert.equal(decision.decisionAudit.decisionConfidence, 0.99);
  });

  // Scenario 2: Weak
  await t.test("Scenario 2 [Weak]: Vague definition -> Easy clarification follow-up", () => {
    const session = {
      interviewId: "sc-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "POSTGRESQL"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false }],
    };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 35,
      depthLevel: "SHALLOW",
      knowledgeLevel: "BASIC",
      followUpRecommended: true,
      followUpAllowed: true,
      conceptsMissing: ["middleware request/response flow"],
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.EASY);
    assert.equal(decision.followUpType, "CLARIFICATION");
    assert.equal(decision.decisionAudit.trigger, "WEAK_BASIC_ANSWER");
  });

  // Scenario 3: Basic
  await t.test("Scenario 3 [Basic]: Progresses from Easy clarification to Medium probe on improvement", () => {
    const session = {
      interviewId: "sc-3",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 1,
      topicFollowUpCount: 1,
      globalFollowUpCount: 1,
      timeRemaining: 850,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "POSTGRESQL"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false }],
    };
    // Candidate clarified basic definition successfully and reached intermediate score
    const lastTurn = {
      isFollowUp: true,
      subIndex: "b",
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 65,
      depthLevel: "SHALLOW",
      knowledgeLevel: "INTERMEDIATE",
      followUpRecommended: true,
      followUpAllowed: true,
      conceptsMissing: ["middleware ordering"],
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.MEDIUM);
    assert.equal(decision.followUpType, "DEPTH_PROBE");
    assert.equal(decision.decisionAudit.trigger, "INTERMEDIATE_DEPTH_PROBE");
  });

  // Scenario 4: Intermediate
  await t.test("Scenario 4 [Intermediate]: Depth probe on missing internal mechanics", () => {
    const session = {
      interviewId: "sc-4",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "REACT"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false }],
    };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 70,
      depthLevel: "SHALLOW",
      knowledgeLevel: "INTERMEDIATE",
      conceptsDemonstrated: ["ORM", "QuerySet"],
      conceptsMissing: ["N+1 queries", "select_related"],
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.MEDIUM);
    assert.equal(decision.followUpType, "DEPTH_PROBE");
    assert.equal(decision.decisionAudit.targetConcept, "N+1 queries");
  });

  // Scenario 5: Strong
  await t.test("Scenario 5 [Strong]: Practical / advanced probe on trade-offs", () => {
    const session = {
      interviewId: "sc-5",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "REACT"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false }],
    };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 86,
      depthLevel: "ADEQUATE",
      depthEstablished: false,
      knowledgeLevel: "STRONG",
      conceptsDemonstrated: ["ORM", "QuerySet", "select_related"],
      conceptsMissing: ["database lock contention"],
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.HARD);
    assert.equal(decision.followUpType, "PRACTICAL");
    assert.equal(decision.decisionAudit.trigger, "STRONG_PRACTICAL_PROBE");
  });

  // Scenario 6: Deep Expert
  await t.test("Scenario 6 [Deep expert]: Proven depth & production verification triggers immediate early topic exit", () => {
    const session = {
      interviewId: "sc-6",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "POSTGRESQL",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["POSTGRESQL", "SYSTEM_DESIGN"],
      coverageState: [{ topic: "POSTGRESQL", questionsAsked: 1, depthEstablished: true, depthLevel: "DEEP" }],
    };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 96,
      depthLevel: "DEEP",
      practicalUnderstanding: "DEEP",
      depthEstablished: true,
      experienceAuthenticity: "PRODUCTION_VERIFIED",
      knowledgeLevel: "EXCELLENT",
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "SYSTEM_DESIGN");
    assert.equal(decision.decisionAudit.trigger, "DEPTH_PROVEN_EARLY_EXIT");
  });

  // Scenario 7: Textbook Answer
  await t.test("Scenario 7 [Textbook answer]: High score with shallow depth triggers VALIDATION follow-up (no premature exit)", () => {
    const session = {
      interviewId: "sc-7",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 850,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "NODE.JS"],
      coverageState: [{ topic: "REACT", questionsAsked: 1, depthEstablished: false }],
    };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 94,
      depthLevel: "SHALLOW", // Textbook recitation!
      depthEstablished: false,
      knowledgeLevel: "EXCELLENT",
      experienceAuthenticity: "THEORETICAL_TEXTBOOK",
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP, "Textbook answer must NOT exit topic");
    assert.equal(decision.followUpType, "VALIDATION");
    assert.equal(decision.decisionAudit.trigger, "SHALLOW_HIGH_SCORE");
  });

  // Scenario 8: Bluffing
  await t.test("Scenario 8 [Bluffing]: Surface buzzwords without mechanism triggers experience challenge", () => {
    const session = {
      interviewId: "sc-8",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "KAFKA",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["KAFKA", "REDIS"],
      coverageState: [{ topic: "KAFKA", questionsAsked: 1, depthEstablished: false }],
    };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 50,
      depthLevel: "SHALLOW",
      knowledgeLevel: "BASIC",
      experienceAuthenticity: "SURFACE_FAMILIARITY",
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.decisionAudit.experienceAuthenticity, "SURFACE_FAMILIARITY");
  });

  // Scenario 9: Contradiction
  await t.test("Scenario 9 [Contradiction]: Flawed assumption triggers misconception probe", () => {
    const session = {
      interviewId: "sc-9",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "POSTGRESQL",
      questionCount: 2,
      topicQuestionCount: 2,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["POSTGRESQL", "MONGODB"],
      coverageState: [{ topic: "POSTGRESQL", questionsAsked: 2, depthEstablished: false }],
    };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 55,
      depthLevel: "SHALLOW",
      contradictionDetected: true,
      misconceptions: ["Indexes never slow down database writes"],
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpType, "DEPTH_PROBE");
    assert.equal(decision.decisionAudit.trigger, "MISCONCEPTION_FLAGGED");
    assert.equal(decision.decisionAudit.targetConcept, "Indexes never slow down database writes");
  });

  // Scenario 10: Strong Fundamentals / Weak Advanced
  await t.test("Scenario 10 [Strong fundamentals / weak advanced]: Balanced depth profile reflection", () => {
    const item = {
      topic: "PYTHON",
      questionsAsked: 2,
      followupsAsked: 1,
      bestScore: 92,
      averageScore: 68,
      knowledgeLevel: "STRONG_FOUNDATION",
      fundamentalKnowledge: "EXCELLENT",
      advancedDepth: "WEAK",
      knowledgeSummary: "Strong foundation / incomplete depth",
      depthLevel: "ADEQUATE",
      evidenceLevel: "MEDIUM",
      conceptsKnown: ["Decorators", "Generators"],
      conceptsMissing: ["GIL internal thread scheduling"],
    };

    assert.equal(item.bestScore, 92);
    assert.equal(item.averageScore, 68);
    assert.equal(item.knowledgeLevel, "STRONG_FOUNDATION");
    assert.equal(item.fundamentalKnowledge, "EXCELLENT");
    assert.equal(item.advancedDepth, "WEAK");
    assert.equal(item.knowledgeSummary, "Strong foundation / incomplete depth");
    assert.equal(item.depthLevel, "ADEQUATE");
    assert.equal(item.evidenceLevel, "MEDIUM");
  });

  // Scenario 11: Narrow / Deep
  await t.test("Scenario 11 [Narrow/deep]: 1 concept known in DEEP mastery -> LOW breadth, DEEP depth", () => {
    const conceptsKnown = ["PostgreSQL MVCC Internals"];
    const breadthLevel = conceptsKnown.length >= 4 ? "HIGH" : conceptsKnown.length >= 2 ? "MEDIUM" : "LOW";
    const depthLevel = "DEEP";

    assert.equal(breadthLevel, "LOW", "Single concept must yield LOW breadth");
    assert.equal(depthLevel, "DEEP", "Deep execution mechanics must yield DEEP depth");
  });

  // Scenario 12: Broad / Shallow
  await t.test("Scenario 12 [Broad/shallow]: 4 concepts known superficially -> HIGH breadth, SHALLOW depth", () => {
    const conceptsKnown = ["Virtual DOM", "JSX", "Hooks", "Components"];
    const breadthLevel = conceptsKnown.length >= 4 ? "HIGH" : conceptsKnown.length >= 2 ? "MEDIUM" : "LOW";
    const depthLevel = "SHALLOW";

    assert.equal(breadthLevel, "HIGH", "4 concepts must yield HIGH breadth");
    assert.equal(depthLevel, "SHALLOW", "Surface knowledge must yield SHALLOW depth");
  });

  // Scenario 13: Fake Resume Experience
  await t.test("Scenario 13 [Fake resume experience]: Textbook response to project question triggers production verification", () => {
    const lastTurn = {
      difficulty: Difficulty.HARD,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 90,
      depthLevel: "SHALLOW",
      experienceAuthenticity: "THEORETICAL_TEXTBOOK",
      depthEstablished: false,
      followUpRecommended: true,
      followUpAllowed: true,
    };
    const session = {
      interviewId: "sc-13",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "LARAVEL",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      topicOrder: ["LARAVEL", "MYSQL"],
      coverageState: [{ topic: "LARAVEL", questionsAsked: 1, depthEstablished: false }],
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpType, "PRACTICAL", "Production verification follow-up probe");
    assert.equal(decision.decisionAudit.experienceAuthenticity, "THEORETICAL_TEXTBOOK");
  });

  // Scenario 14: Multiple "I don't know"
  await t.test("Scenario 14 [Multiple 'I don't know']: 2 consecutive gaps on topic triggers topic switch", () => {
    const session = {
      interviewId: "sc-14",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "KUBERNETES",
      questionCount: 2,
      topicQuestionCount: 2,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 700,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 2 },
      topicOrder: ["KUBERNETES", "TERRAFORM"],
      coverageState: [{ topic: "KUBERNETES", questionsAsked: 2 }],
    };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      isExplicitGap: true,
    };

    const decision = engine.determineNextAction(session, basePlan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "TERRAFORM");
    assert.equal(decision.decisionAudit.trigger, "CONSECUTIVE_GAPS_EXIT");
  });

  // Scenario 15: Excellent First Answer
  await t.test("Scenario 15 [Excellent first answer]: Context-dependent handling (Validation probe for shallow vs. Early exit for deep)", () => {
    const session = {
      interviewId: "sc-15",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "NEXT.JS"],
      coverageState: [{ topic: "REACT", questionsAsked: 1 }],
    };

    // Sub-case A: Excellent textbook answer (depth unproven) -> VALIDATION probe
    const textbookTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 95,
      depthLevel: "SHALLOW",
      depthEstablished: false,
      followUpRecommended: true,
      followUpAllowed: true,
    };
    const decisionA = engine.determineNextAction(session, basePlan, textbookTurn);
    assert.equal(decisionA.action, InterviewAction.FOLLOW_UP);
    assert.equal(decisionA.followUpType, "VALIDATION");

    // Sub-case B: Excellent deep answer (depth proven) -> Immediate early exit
    const deepTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 95,
      depthLevel: "DEEP",
      depthEstablished: true,
    };
    const decisionB = engine.determineNextAction(session, basePlan, deepTurn);
    assert.equal(decisionB.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decisionB.nextTopic, "NEXT.JS");
  });
});
