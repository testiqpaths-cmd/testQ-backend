import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { AnswerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { QuestionService } from "../src/ai-interview/services/question.service.js";
import { InterviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";

test("Knowledge-Depth Interviewer Behavior", async (t) => {
  const engine = new AdaptiveEngineService();
  const analysisService = new AnswerAnalysisService({
    analyzeCandidateAnswer: async () => ({
      answerStatus: AnswerStatus.PARTIAL,
      relevanceScore: 75,
      correctnessScore: 65,
      completenessScore: 55,
      confidence: 70,
      depthLevel: "SHALLOW",
      knowledgeLevel: "INTERMEDIATE",
      knowledgeConfidence: 75,
      depthEstablished: false,
      practicalUnderstanding: "BASIC",
      conceptsDemonstrated: ["ORM", "QuerySet"],
      conceptsMissing: ["N+1 queries", "select_related"],
      followUpRecommended: true,
      followUpReason: "Probe query optimization and N+1 queries",
      followUpType: "DEPTH_PROBE",
    }),
  });

  await t.test("1. Proven depth triggers immediate SWITCH_TOPIC (early exit before topic question budget met)", () => {
    const session = {
      interviewId: "int-depth-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1, // Only 1 question asked!
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { streakCorrect: 1 },
      topicOrder: ["DJANGO", "REACT", "MYSQL"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3 };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
      depthLevel: "DEEP",
      correctnessScore: 92,
      depthEstablished: true, // Candidate demonstrated deep mastery!
      knowledgeLevel: "DEEP",
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC, "Proven depth must exit topic early without asking redundant questions");
    assert.equal(decision.nextTopic, "REACT");
  });

  await t.test("2. Unproven depth triggers targeted follow-up within topic budget", () => {
    const session = {
      interviewId: "int-depth-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "REACT"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false, followupsAsked: 0 }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      depthLevel: "SHALLOW",
      correctnessScore: 65,
      depthEstablished: false,
      knowledgeLevel: "INTERMEDIATE",
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.difficulty, Difficulty.MEDIUM);
    assert.match(decision.reason, /intermediate grasp/i);
  });

  await t.test("3. Chained follow-up: allows follow-up 2 on topic when depth still unproven and under topic ceiling", () => {
    const session = {
      interviewId: "int-depth-3",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 1, // Already had 1 follow-up on this topic
      topicFollowUpCount: 1,
      globalFollowUpCount: 1,
      timeRemaining: 850,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "REACT"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false, followupsAsked: 1 }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };
    const lastTurn = {
      isFollowUp: true,
      subIndex: "b",
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      depthLevel: "SHALLOW",
      correctnessScore: 70,
      depthEstablished: false,
      knowledgeLevel: "INTERMEDIATE",
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP, "Must allow follow-up 2 when under maxFollowUpsPerTopic ceiling");
  });

  await t.test("4. Exceeding topic follow-up ceiling (>= 3) switches to next topic", () => {
    const session = {
      interviewId: "int-depth-4",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "DJANGO",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 3,
      topicFollowUpCount: 3, // Reached 3 follow-ups on topic
      globalFollowUpCount: 3,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["DJANGO", "REACT"],
      coverageState: [{ topic: "DJANGO", questionsAsked: 1, depthEstablished: false, followupsAsked: 3 }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 4, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };
    const lastTurn = {
      isFollowUp: true,
      subIndex: "d",
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      depthEstablished: false,
      followUpRecommended: true,
      followUpAllowed: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC, "Must switch topic after reaching topic follow-up ceiling");
    assert.equal(decision.nextTopic, "REACT");
  });

  await t.test("5. Hedging detector: 'not sure, but I think...' with technical explanation is NOT treated as a blind gap", () => {
    const hedgingAnswer = "I'm not completely sure, but I think Django middleware intercepts the HTTP request before passing it to the view handler.";
    const isGap = analysisService.isExplicitKnowledgeGap(hedgingAnswer);
    assert.equal(isGap, false, "Technical hedging must not be classified as a blind knowledge gap");

    const pureGap = "I don't know";
    assert.equal(analysisService.isExplicitKnowledgeGap(pureGap), true, "Direct 'I don't know' must be classified as gap");

    const passGap = "skip this question";
    assert.equal(analysisService.isExplicitKnowledgeGap(passGap), true, "Skip must be classified as gap");
  });

  await t.test("6. QuestionService: chained follow-up increments subIndex properly (b -> c -> d)", async () => {
    // Stub Mongoose calls for offline unit test
    const origFind = InterviewTurn.find;
    const origFindOne = InterviewTurn.findOne;
    const origSave = InterviewTurn.prototype.save;

    try {
      InterviewTurn.find = () => ({
        select: () => ({
          lean: async () => [],
        }),
      });
      InterviewTurn.findOne = () => ({
        sort: () => ({
          select: async () => ({ turnNumber: 2 }),
        }),
      });
      InterviewTurn.prototype.save = async function () {
        return this;
      };

      const mockAi = {
        generateFollowUpQuestion: async () => ({
          question: "Can you explain how select_related eliminates N+1 query overhead in PostgreSQL?",
          concept: "select_related query optimization",
          topic: "DJANGO",
          difficulty: "MEDIUM",
          questionType: "DEPTH_PROBE",
          competency: "Technical Knowledge",
        }),
      };
      const qService = new QuestionService(mockAi);
      const mockSession = {
        _id: new mongoose.Types.ObjectId(),
        interviewId: "int-sub-1",
        role: "Backend Engineer",
        experienceLevel: "2-4 Years",
      };
      const mockPlan = { maxFollowUpsPerTopic: 3 };
      const previousTurn = {
        _id: new mongoose.Types.ObjectId(),
        topic: "DJANGO",
        difficulty: "MEDIUM",
        question: "What is Django ORM?",
        isFollowUp: true,
        subIndex: "b",
        conceptsMissing: ["N+1 queries"],
        conceptsDemonstrated: ["QuerySet"],
      };

      const result = await qService.generateFollowUpQuestion(mockSession, mockPlan, previousTurn, {
        difficulty: "MEDIUM",
        followUpType: "DEPTH_PROBE",
      });

      assert.equal(result.subIndex, "c", "Follow-up chain must increment subIndex to 'c'");
      assert.equal(result.questionType, "DEPTH_PROBE");
      assert.equal(result.isFollowUp, true);
    } finally {
      InterviewTurn.find = origFind;
      InterviewTurn.findOne = origFindOne;
      InterviewTurn.prototype.save = origSave;
    }
  });
});
