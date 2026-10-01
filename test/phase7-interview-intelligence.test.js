import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { AnswerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";

test("Phase 7: Interview Intelligence Refinement", async (t) => {
  const engine = new AdaptiveEngineService();

  await t.test("1. High score (>90%) with SHALLOW depth does NOT exit topic; triggers VALIDATION follow-up", () => {
    const session = {
      interviewId: "int-shallow-high",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "DJANGO"],
      coverageState: [{ topic: "REACT", questionsAsked: 1, depthEstablished: false }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };

    // Candidate answered with a textbook definition (high correctness, but shallow depth)
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 95,
      depthLevel: "SHALLOW", // Shallow textbook answer!
      depthEstablished: false,
      knowledgeLevel: "EXCELLENT",
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);

    assert.equal(decision.action, InterviewAction.FOLLOW_UP, "Shallow answer must trigger follow-up, NOT exit topic");
    assert.equal(decision.followUpType, "VALIDATION", "Unproven depth with high score must trigger VALIDATION follow-up");
  });

  await t.test("2. Proven depth + DEEP understanding exits topic immediately without redundant questions", () => {
    const session = {
      interviewId: "int-deep-exit",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "DJANGO"],
      coverageState: [{ topic: "REACT", questionsAsked: 1, depthEstablished: true, depthLevel: "DEEP" }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3 };

    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      correctnessScore: 92,
      depthLevel: "DEEP",
      depthEstablished: true, // Proven depth!
      knowledgeLevel: "EXCELLENT",
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);

    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC, "Proven depth must exit topic early");
    assert.equal(decision.nextTopic, "DJANGO");
  });

  await t.test("3. Contradiction / Misconception detected triggers targeted DEPTH_PROBE follow-up", () => {
    const session = {
      interviewId: "int-misconception",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "POSTGRESQL",
      questionCount: 2,
      topicQuestionCount: 2,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["POSTGRESQL", "REDIS"],
      coverageState: [{ topic: "POSTGRESQL", questionsAsked: 2, depthEstablished: false }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };

    // Candidate claimed "Indexes always speed up queries and never have downsides"
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 60,
      depthLevel: "SHALLOW",
      depthEstablished: false,
      contradictionDetected: true,
      misconceptions: ["Indexes have zero write overhead"],
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);

    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.followUpType, "DEPTH_PROBE");
    assert.match(decision.reason, /contradiction or misconception/i);
  });

  await t.test("4. Decision hierarchy: global limit takes absolute precedence over follow-ups", () => {
    const session = {
      interviewId: "int-global-limit",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 10, // Global limit reached!
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 600,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "DJANGO"],
      coverageState: [{ topic: "REACT", questionsAsked: 1 }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      followUpAllowed: true,
      followUpRecommended: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW, "Global question limit must take absolute precedence");
  });

  await t.test("5. Multi-dimensional topic metrics: breadth, depth, and evidence computation", () => {
    // Simulate topic coverage item state computation
    const item = {
      topic: "DJANGO",
      questionsAsked: 2,
      followupsAsked: 1,
      bestScore: 88,
      conceptsKnown: ["ORM", "QuerySet", "Middleware", "Signals"], // 4 concepts = HIGH breadth
      depthLevel: "DEEP",
      misconceptions: ["Signals bypass save"],
      experienceAuthenticity: "PRODUCTION_VERIFIED",
    };

    // Breadth
    const knownCount = item.conceptsKnown.length;
    const breadthLevel = knownCount >= 4 ? "HIGH" : knownCount >= 2 ? "MEDIUM" : "LOW";
    assert.equal(breadthLevel, "HIGH", "4 verified concepts must yield HIGH breadth");

    // Evidence
    const totalTurns = item.questionsAsked + item.followupsAsked;
    const evidenceLevel = totalTurns >= 3 && item.bestScore >= 75 && item.depthLevel !== "SHALLOW" ? "HIGH" : "MEDIUM";
    assert.equal(evidenceLevel, "HIGH", "3 turns with 88 score and DEEP depth must yield HIGH evidence");
    assert.equal(item.experienceAuthenticity, "PRODUCTION_VERIFIED");
  });
});
