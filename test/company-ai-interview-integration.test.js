import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TestSeries from "../src/models/testSeries.model.js";
import CompanyTrackAttempt from "../src/models/companyTrackAttempt.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import InterviewSession from "../src/ai-interview/schemas/interview-session.schema.js";
import {
  launchCompanyInterviewRound,
  updateTrackAttemptFromInterviewSession,
  updateTrackAttemptProgress,
  retakeTrackAttempt,
} from "../src/modules/company-exams/companyExam.service.js";
import { interviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { aiAnswerAnalysisService } from "../src/ai-interview/ai/ai-answer-analysis.service.js";

const { Types } = mongoose;

describe("Step 5: AI Interview Session Integration & Mixed Progression Tests", () => {
  const dummyUserId = new Types.ObjectId();
  const dummyOtherUserId = new Types.ObjectId();
  const dummyCompanyId = new Types.ObjectId();
  const dummyTrackId = new Types.ObjectId();
  const dummyTestId = new Types.ObjectId();

  /* ── 1. CONFIG MAPPING & CUSTOM RUBRIC ── */
  describe("1. Configuration Mapping & Custom Rubric Application", () => {
    test("1.1 createCustomInterview correctly applies company track metadata and prioritized focus topics", async () => {
      const origSave = InterviewSession.prototype.save;
      const { interviewPlanService } = await import("../src/ai-interview/services/interview-plan.service.js");
      const { questionPlannerService } = await import("../src/ai-interview/services/interview-question-planner.service.js");
      const origCreatePlan = interviewPlanService.createPlan;
      const origReplenish = questionPlannerService.replenishPoolInBackground;

      let savedDoc = null;
      InterviewSession.prototype.save = async function () {
        savedDoc = this;
        return this;
      };

      interviewPlanService.createPlan = async ({ topics, duration, difficulty }) => ({
        _id: new Types.ObjectId(),
        topics,
        duration,
        difficulty,
        globalQuestionLimit: 10,
        save: async () => {},
      });

      questionPlannerService.replenishPoolInBackground = () => {};

      const payload = {
        role: "Senior Backend Engineer",
        experienceLevel: "EXPERIENCED_3_PLUS",
        duration: 45,
        difficulty: "HARD",
        interviewTypes: ["technical", "system_design"],
        topics: ["DISTRIBUTED_SYSTEMS", "POSTGRESQL"],
        customRubric: "Strict emphasis on ACID trade-offs and CAP theorem.",
        company: "Google",
        companyId: dummyCompanyId,
        trackId: dummyTrackId,
        trackAttemptId: new Types.ObjectId(),
        companyRoundOrder: 2,
        companyRoundKey: "ROUND_AI_INT",
      };

      try {
        const session = await interviewSessionService.createCustomInterview(dummyUserId, payload);
        assert.ok(session);
        assert.equal(savedDoc.role, "Senior Backend Engineer");
        assert.equal(savedDoc.experienceLevel, "EXPERIENCED_3_PLUS");
        assert.equal(savedDoc.duration, 45);
        assert.equal(savedDoc.difficulty, "HARD");
        assert.equal(savedDoc.customRubric, "Strict emphasis on ACID trade-offs and CAP theorem.");
        assert.equal(String(savedDoc.companyId), String(dummyCompanyId));
        assert.equal(String(savedDoc.trackId), String(dummyTrackId));
        assert.equal(savedDoc.companyRoundOrder, 2);
        assert.equal(savedDoc.companyRoundKey, "ROUND_AI_INT");
        assert.ok(savedDoc.allowedTopics.includes("DISTRIBUTED_SYSTEMS"));
        assert.ok(savedDoc.allowedTopics.includes("POSTGRESQL"));
      } finally {
        InterviewSession.prototype.save = origSave;
        interviewPlanService.createPlan = origCreatePlan;
        questionPlannerService.replenishPoolInBackground = origReplenish;
      }
    });

    test("1.2 aiAnswerAnalysisService incorporates customRubric into system prompt", async () => {
      let capturedSystemPrompt = null;
      const origLlm = aiAnswerAnalysisService.llm;
      aiAnswerAnalysisService.llm = {
        generateStructuredJson: async ({ systemPrompt }) => {
          capturedSystemPrompt = systemPrompt;
          return {
            answerStatus: "ACCURATE",
            correctnessScore: 90,
            completenessScore: 85,
            relevanceScore: 95,
            depthLevel: "DEEP",
            confidence: 90,
            knowledgeLevel: "STRONG",
            knowledgeConfidence: 90,
            depthEstablished: true,
            evidenceLevel: "HIGH",
            contradictionDetected: false,
            contradictionDetails: null,
            misconceptions: [],
            experienceAuthenticity: "PRODUCTION_VERIFIED",
            practicalUnderstanding: "DEEP",
            conceptsDemonstrated: ["replication"],
            conceptsMissing: [],
            isExplicitGap: false,
            feedbackSummary: "Great answer",
            followUpRecommended: false,
            followUpReason: "Comprehensive",
            followUpType: "NONE",
            difficultyRecommendation: null,
            topicContinuationRecommended: false,
          };
        },
      };

      try {
        await aiAnswerAnalysisService.analyzeCandidateAnswer({
          question: "Explain database replication lag",
          candidateAnswer: "Replication lag occurs when follower nodes process WAL logs asynchronously.",
          topic: "POSTGRESQL",
          difficulty: "HARD",
          role: "Database Engineer",
          customRubric: "Evaluate based on raft consensus knowledge and write-ahead log internals.",
        });

        assert.ok(capturedSystemPrompt);
        assert.ok(
          capturedSystemPrompt.includes("CUSTOM COMPANY EVALUATION RUBRIC"),
          "System prompt must include the custom rubric header"
        );
        assert.ok(
          capturedSystemPrompt.includes("Evaluate based on raft consensus knowledge"),
          "System prompt must contain the custom rubric instructions"
        );
      } finally {
        aiAnswerAnalysisService.llm = origLlm;
      }
    });
  });

  /* ── 2. LAUNCH GATING & DUPLICATE PREVENTION ── */
  describe("2. Launch Gating, Ownership & Session Resumption", () => {
    test("2.1 launchCompanyInterviewRound blocks launch if round is LOCKED in SEQUENTIAL mode", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "SEQUENTIAL",
        mode: "SIMULATION",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "Online Assessment", roundType: "TESTS", cutoffPercentage: 60, tests: [dummyTestId] },
          { roundOrder: 2, roundKey: "R2", roundName: "AI Interview", roundType: "AI_INTERVIEW", cutoffPercentage: 70 },
        ],
      };

      // Active track attempt has Round 1 FAILED and Round 2 LOCKED
      const mockAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "FAILED", percentage: 45, cutoffPercentage: 60 },
          { roundOrder: 2, status: "LOCKED", percentage: 0 },
        ],
      };

      TestSeries.findById = () => {
        const query = {
          populate: () => query,
          lean: async () => mockTrack,
        };
        return query;
      };

      CompanyTrackAttempt.findOne = () => mockAttempt;

      try {
        await assert.rejects(
          async () => {
            await launchCompanyInterviewRound({
              studentId: dummyUserId.toString(),
              trackId: dummyTrackId.toString(),
              roundOrder: 2,
            });
          },
          (err) => {
            assert.equal(err.statusCode, 403);
            assert.ok(err.message.includes("Round 1 cutoff not met"));
            return true;
          }
        );
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
      }
    });

    test("2.2 launchCompanyInterviewRound rejects launch on non-interview round", async () => {
      const origTrackFindById = TestSeries.findById;
      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "Online Assessment", roundType: "TESTS", tests: [dummyTestId] },
        ],
      };

      TestSeries.findById = () => {
        const query = {
          populate: () => query,
          lean: async () => mockTrack,
        };
        return query;
      };

      try {
        await assert.rejects(
          async () => {
            await launchCompanyInterviewRound({
              studentId: dummyUserId.toString(),
              trackId: dummyTrackId.toString(),
              roundOrder: 1,
            });
          },
          (err) => {
            assert.equal(err.statusCode, 400);
            assert.ok(err.message.includes("not an AI Interview stage"));
            return true;
          }
        );
      } finally {
        TestSeries.findById = origTrackFindById;
      }
    });

    test("2.3 launchCompanyInterviewRound resumes existing in-progress session without duplicate creation", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origSessionFindOne = InterviewSession.findOne;
      let createSessionCalled = false;
      const origCreateSession = interviewSessionService.createCustomInterview;
      interviewSessionService.createCustomInterview = async () => {
        createSessionCalled = true;
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "AI Interview", roundType: "AI_INTERVIEW", cutoffPercentage: 60 },
        ],
      };

      const existingSessionId = "int-1729000-resumable";
      const mockAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "IN_PROGRESS", interviewSessionId: existingSessionId },
        ],
      };

      const mockSession = {
        interviewId: existingSessionId,
        userId: dummyUserId,
        interviewState: "READY",
      };

      TestSeries.findById = () => {
        const query = {
          populate: () => query,
          lean: async () => mockTrack,
        };
        return query;
      };
      CompanyTrackAttempt.findOne = () => mockAttempt;
      InterviewSession.findOne = async () => mockSession;

      try {
        const result = await launchCompanyInterviewRound({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });

        assert.equal(result.isResumed, true);
        assert.equal(result.interviewId, existingSessionId);
        assert.equal(createSessionCalled, false, "Must not create a new session if one is already active");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        InterviewSession.findOne = origSessionFindOne;
        interviewSessionService.createCustomInterview = origCreateSession;
      }
    });
  });

  /* ── 3. INTERVIEW COMPLETION & TRACK PROGRESSION ── */
  describe("3. Interview Completion Score Normalization & Progression", () => {
    test("3.1 updateTrackAttemptFromInterviewSession marks round PASSED and unlocks next round when cutoff met", async () => {
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "AI Interview", roundType: "AI_INTERVIEW", cutoffPercentage: 70, weight: 100 },
          { roundOrder: 2, roundKey: "R2", roundName: "Executive Round", roundType: "AI_INTERVIEW", cutoffPercentage: 75, weight: 100 },
        ],
      };

      let saved = false;
      const mockTrackAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          { roundOrder: 1, roundKey: "R1", roundType: "AI_INTERVIEW", status: "IN_PROGRESS", cutoffPercentage: 70 },
          { roundOrder: 2, roundKey: "R2", roundType: "AI_INTERVIEW", status: "LOCKED", cutoffPercentage: 75 },
        ],
        save: async () => {
          saved = true;
        },
      };

      const mockSession = {
        interviewId: "int-eval-passed",
        userId: dummyUserId,
        trackAttemptId: mockTrackAttempt._id,
        trackId: dummyTrackId,
        companyRoundOrder: 1,
        interviewState: "COMPLETED",
        resultsSummary: { score: 82, readinessScore: 85 },
      };

      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });

      try {
        const result = await updateTrackAttemptFromInterviewSession(mockSession);
        assert.ok(result);
        assert.equal(mockTrackAttempt.roundAttempts[0].status, "PASSED");
        assert.equal(mockTrackAttempt.roundAttempts[0].scoreObtained, 82);
        assert.equal(mockTrackAttempt.roundAttempts[0].percentage, 82);
        assert.equal(mockTrackAttempt.roundAttempts[1].status, "READY", "Round 2 must unlock to READY");
        assert.equal(mockTrackAttempt.currentRoundOrder, 2);
        assert.equal(mockTrackAttempt.status, "IN_PROGRESS", "Track must remain IN_PROGRESS because Round 2 is pending");
        assert.equal(saved, true);
      } finally {
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
      }
    });

    test("3.2 updateTrackAttemptFromInterviewSession marks round FAILED and track NOT_QUALIFIED in SIMULATION mode on cutoff failure", async () => {
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "AI Interview", roundType: "AI_INTERVIEW", cutoffPercentage: 70 },
        ],
      };

      const mockTrackAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, roundKey: "R1", roundType: "AI_INTERVIEW", status: "IN_PROGRESS", cutoffPercentage: 70 },
        ],
        save: async () => {},
      };

      const mockSession = {
        interviewId: "int-eval-failed",
        userId: dummyUserId,
        trackAttemptId: mockTrackAttempt._id,
        companyRoundOrder: 1,
        interviewState: "COMPLETED",
        resultsSummary: { score: 55, readinessScore: 50 },
      };

      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });

      try {
        await updateTrackAttemptFromInterviewSession(mockSession);
        assert.equal(mockTrackAttempt.roundAttempts[0].status, "FAILED");
        assert.equal(mockTrackAttempt.status, "NOT_QUALIFIED", "Simulation cutoff failure must mark track NOT_QUALIFIED");
      } finally {
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
      }
    });

    test("3.3 updateTrackAttemptFromInterviewSession is idempotent and safe against repeated calls", async () => {
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "PRACTICE",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "AI Interview", roundType: "AI_INTERVIEW", cutoffPercentage: 60 },
        ],
      };

      const mockTrackAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, roundKey: "R1", roundType: "AI_INTERVIEW", status: "IN_PROGRESS", cutoffPercentage: 60 },
        ],
        save: async () => {},
      };

      const mockSession = {
        interviewId: "int-repeat-call",
        userId: dummyUserId,
        trackAttemptId: mockTrackAttempt._id,
        companyRoundOrder: 1,
        interviewState: "COMPLETED",
        resultsSummary: { score: 80 },
      };

      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });

      try {
        // First call
        await updateTrackAttemptFromInterviewSession(mockSession);
        assert.equal(mockTrackAttempt.roundAttempts[0].status, "PASSED");
        assert.equal(mockTrackAttempt.status, "QUALIFIED");

        // Second call with same completed data must not corrupt status
        await updateTrackAttemptFromInterviewSession(mockSession);
        assert.equal(mockTrackAttempt.roundAttempts[0].status, "PASSED");
        assert.equal(mockTrackAttempt.status, "QUALIFIED");
      } finally {
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
      }
    });
  });

  /* ── 4. MIXED-ROUND COMPLETION GATE & RETAKE POLICIES ── */
  describe("4. Mixed-Round Completion Gate & Carry-Forward Edge Cases", () => {
    test("4.1 Mixed Track: passing Round 1 TESTS does NOT qualify track when Round 2 AI_INTERVIEW is pending", async () => {
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;
      const origTestAttemptFind = TestAttempt.find;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "Technical Test", roundType: "TESTS", cutoffPercentage: 60, weight: 50, tests: [dummyTestId] },
          { roundOrder: 2, roundKey: "R2", roundName: "AI Interview", roundType: "AI_INTERVIEW", cutoffPercentage: 70, weight: 50 },
        ],
      };

      const mockTrackAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          { roundOrder: 1, roundKey: "R1", roundType: "TESTS", status: "IN_PROGRESS", cutoffPercentage: 60, testAttemptIds: [new Types.ObjectId()] },
          { roundOrder: 2, roundKey: "R2", roundType: "AI_INTERVIEW", status: "LOCKED", cutoffPercentage: 70 },
        ],
        save: async () => {},
      };

      const mockTestAttempt = {
        _id: mockTrackAttempt.roundAttempts[0].testAttemptIds[0],
        testId: dummyTestId,
        companyTrackAttemptId: mockTrackAttempt._id,
        companyRoundOrder: 1,
        status: "SUBMITTED",
        totalScore: 80,
        maxScore: 100,
        percentage: 80,
      };

      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      TestAttempt.find = () => ({
        lean: async () => [mockTestAttempt],
      });

      try {
        await updateTrackAttemptProgress(mockTestAttempt);

        assert.equal(mockTrackAttempt.roundAttempts[0].status, "PASSED", "Round 1 tests passed");
        assert.equal(mockTrackAttempt.roundAttempts[1].status, "READY", "Round 2 AI Interview unlocked");
        assert.equal(
          mockTrackAttempt.status,
          "IN_PROGRESS",
          "Track must NOT be QUALIFIED yet because AI Interview round is not passed"
        );
      } finally {
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
        TestAttempt.find = origTestAttemptFind;
      }
    });

    test("4.2 retakeTrackAttempt in PRACTICE mode: ALL_TESTS clears testAttemptIds, FAILED_ONLY retains passed tests", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origTestAttemptFind = TestAttempt.find;

      const dummyPassTestId = new Types.ObjectId();
      const dummyFailTestId = new Types.ObjectId();

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "PRACTICE",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundType: "TESTS", retakePolicy: "FAILED_ONLY", cutoffPercentage: 50 },
          { roundOrder: 2, roundKey: "R2", roundType: "TESTS", retakePolicy: "ALL_TESTS", cutoffPercentage: 50 },
        ],
      };

      const passAttId = new Types.ObjectId();
      const failAttId = new Types.ObjectId();

      const activeDrive = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "FAILED", testAttemptIds: [passAttId, failAttId] },
          { roundOrder: 2, status: "FAILED", testAttemptIds: [new Types.ObjectId()] },
        ],
        save: async () => {},
      };

      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      CompanyTrackAttempt.findOne = () => ({
        sort: async () => activeDrive,
      });
      TestAttempt.find = () => ({
        lean: async () => [
          { _id: passAttId, percentage: 80 },
          { _id: failAttId, percentage: 30 },
        ],
      });

      try {
        // Case A: FAILED_ONLY on Round 1
        await retakeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });

        assert.equal(activeDrive.roundAttempts[0].status, "READY");
        assert.equal(activeDrive.roundAttempts[0].testAttemptIds.length, 1);
        assert.equal(String(activeDrive.roundAttempts[0].testAttemptIds[0]), String(passAttId));

        // Case B: ALL_TESTS on Round 2
        await retakeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 2,
        });

        assert.equal(activeDrive.roundAttempts[1].status, "READY");
        assert.equal(activeDrive.roundAttempts[1].testAttemptIds.length, 0, "ALL_TESTS must clear all test attempt IDs");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        TestAttempt.find = origTestAttemptFind;
      }
    });

    test("4.3 retakeTrackAttempt on AI_INTERVIEW round resets round status to READY and unlinks session ID", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "PRACTICE",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundType: "AI_INTERVIEW", cutoffPercentage: 60 },
        ],
      };

      const activeDrive = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "FAILED", interviewSessionId: "int-historical-preserved", percentage: 40 },
        ],
        save: async () => {},
      };

      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      CompanyTrackAttempt.findOne = () => ({
        sort: async () => activeDrive,
      });

      try {
        const res = await retakeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });

        assert.equal(res.isNewDrive, false);
        assert.equal(activeDrive.roundAttempts[0].status, "READY");
        assert.equal(activeDrive.roundAttempts[0].interviewSessionId, null, "Active session pointer must be reset");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
      }
    });

    test("4.4 Standalone AI Interviews without company metadata complete normally without touching track progression", async () => {
      const standaloneSession = {
        interviewId: "int-standalone-001",
        userId: dummyUserId,
        interviewState: "COMPLETED",
        resultsSummary: { score: 92 },
      };

      const res = await updateTrackAttemptFromInterviewSession(standaloneSession);
      assert.equal(res, null, "Standalone interviews must return null and have zero side effects on company tracks");
    });
  });

  /* ── 5. PREDEFINED VS RESUME-BASED VS HYBRID AI INTERVIEWS ── */
  describe("5. Predefined vs Resume-Based vs Hybrid Company AI Interview Options", () => {
    test("5.1 hiringRoundSchema accepts PREDEFINED, RESUME_BASED, and HYBRID interview modes with resume options", async () => {
      const { hiringRoundSchema } = await import("../src/modules/test-management/schemas/testSeries.schema.js");

      // Predefined round
      const predefinedRound = {
        roundOrder: 1,
        roundKey: "ROUND_1_PREDEFINED",
        roundName: "Predefined Standard Interview",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "PREDEFINED",
          allowResumeUpload: false,
          requireResume: false,
          role: "Frontend Engineer",
          experienceLevel: "FRESHER",
          topics: ["REACT", "JAVASCRIPT"],
          durationMinutes: 30,
          difficulty: "MEDIUM",
        },
      };
      const res1 = hiringRoundSchema.safeParse(predefinedRound);
      assert.equal(res1.success, true);
      assert.equal(res1.data.aiInterviewConfig.interviewMode, "PREDEFINED");
      assert.equal(res1.data.aiInterviewConfig.allowResumeUpload, false);

      // Resume-based round
      const resumeBasedRound = {
        roundOrder: 2,
        roundKey: "ROUND_2_RESUME",
        roundName: "Resume Grounded Interview",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "RESUME_BASED",
          allowResumeUpload: true,
          requireResume: true,
          role: "Full Stack Engineer",
          experienceLevel: "MID",
          durationMinutes: 45,
          difficulty: "HARD",
        },
      };
      const res2 = hiringRoundSchema.safeParse(resumeBasedRound);
      assert.equal(res2.success, true);
      assert.equal(res2.data.aiInterviewConfig.interviewMode, "RESUME_BASED");
      assert.equal(res2.data.aiInterviewConfig.requireResume, true);

      // Hybrid round
      const hybridRound = {
        roundOrder: 3,
        roundKey: "ROUND_3_HYBRID",
        roundName: "Hybrid Standard + Resume Interview",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "HYBRID",
          allowResumeUpload: true,
          requireResume: false,
          role: "Backend Architect",
          experienceLevel: "SENIOR",
          topics: ["DISTRIBUTED_SYSTEMS", "KAFKA"],
          durationMinutes: 60,
          difficulty: "HARD",
        },
      };
      const res3 = hiringRoundSchema.safeParse(hybridRound);
      assert.equal(res3.success, true);
      assert.equal(res3.data.aiInterviewConfig.interviewMode, "HYBRID");
      assert.equal(res3.data.aiInterviewConfig.allowResumeUpload, true);
    });

    test("5.2 launchCompanyInterviewRound invokes createResumeInterview when resumeId is provided", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      let resumeInterviewCreated = false;
      let passedPayload = null;

      const origCreateResume = interviewSessionService.createResumeInterview;
      interviewSessionService.createResumeInterview = async (userId, file, payload) => {
        resumeInterviewCreated = true;
        passedPayload = payload;
        return {
          interviewId: "int-resume-launched-001",
          role: payload.role,
          duration: payload.duration,
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        companyId: { _id: dummyCompanyId, name: "Amazon" },
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1_RESUME",
            roundName: "Resume Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 60,
            aiInterviewConfig: {
              interviewMode: "RESUME_BASED",
              allowResumeUpload: true,
              requireResume: true,
              role: "Cloud Specialist",
              topics: ["AWS", "DOCKER"],
            },
          },
        ],
      };

      const mockAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "READY", interviewSessionId: null },
        ],
        save: async () => {},
      };

      const mockQuery = {
        populate: () => mockQuery,
        lean: async () => mockTrack,
      };
      TestSeries.findById = () => mockQuery;
      CompanyTrackAttempt.findOne = () => mockAttempt;

      try {
        const result = await launchCompanyInterviewRound({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
          body: { resumeId: "resume-test-12345" },
        });

        assert.equal(resumeInterviewCreated, true, "createResumeInterview must be invoked for resume interview round");
        assert.equal(result.interviewId, "int-resume-launched-001");
        assert.equal(passedPayload.resumeId, "resume-test-12345");
        assert.equal(passedPayload.role, "Cloud Specialist");
        assert.equal(String(passedPayload.trackId), String(dummyTrackId));
        assert.equal(passedPayload.companyRoundOrder, 1);
        assert.equal(mockAttempt.roundAttempts[0].status, "IN_PROGRESS");
        assert.equal(mockAttempt.roundAttempts[0].interviewSessionId, "int-resume-launched-001");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createResumeInterview = origCreateResume;
      }
    });

    test("5.3 launchCompanyInterviewRound rejects launch when requireResume is true and no resume is found", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const { resumeService } = await import("../src/ai-interview/resume/resume.service.js");
      const origGetLatest = resumeService.getLatestForUser;
      resumeService.getLatestForUser = async () => null; // No resume on file

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1_REQ_RESUME",
            roundName: "Mandatory Resume Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 60,
            aiInterviewConfig: {
              interviewMode: "RESUME_BASED",
              requireResume: true,
              role: "Data Scientist",
            },
          },
        ],
      };

      const mockAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "READY", interviewSessionId: null },
        ],
        save: async () => {},
      };

      const mockQuery = {
        populate: () => mockQuery,
        lean: async () => mockTrack,
      };
      TestSeries.findById = () => mockQuery;
      CompanyTrackAttempt.findOne = () => mockAttempt;

      try {
        await assert.rejects(
          async () => {
            await launchCompanyInterviewRound({
              studentId: dummyUserId.toString(),
              trackId: dummyTrackId.toString(),
              roundOrder: 1,
              file: null,
              body: {}, // No resumeId provided
            });
          },
          (err) => {
            assert.equal(err.statusCode, 400);
            assert.ok(err.message.includes("Candidate resume is required"));
            return true;
          }
        );
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        resumeService.getLatestForUser = origGetLatest;
      }
    });

    test("5.4 launchCompanyInterviewRound launches PREDEFINED round with custom interview without requiring resume", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      let customInterviewCreated = false;
      let passedPayload = null;

      const origCreateCustom = interviewSessionService.createCustomInterview;
      interviewSessionService.createCustomInterview = async (userId, payload) => {
        customInterviewCreated = true;
        passedPayload = payload;
        return {
          interviewId: "int-predefined-launched-002",
          role: payload.role,
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        companyId: { _id: dummyCompanyId, name: "Microsoft" },
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1_PREDEFINED",
            roundName: "Predefined Standard Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 60,
            aiInterviewConfig: {
              interviewMode: "PREDEFINED",
              requireResume: false,
              allowResumeUpload: false,
              role: "Core C# Developer",
              topics: ["DOTNET", "CSHARP", "ASPNET"],
            },
          },
        ],
      };

      const mockAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "READY", interviewSessionId: null },
        ],
        save: async () => {},
      };

      const mockQuery = {
        populate: () => mockQuery,
        lean: async () => mockTrack,
      };
      TestSeries.findById = () => mockQuery;
      CompanyTrackAttempt.findOne = () => mockAttempt;

      try {
        const result = await launchCompanyInterviewRound({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });

        assert.equal(customInterviewCreated, true, "createCustomInterview must be invoked for predefined standard round");
        assert.equal(result.interviewId, "int-predefined-launched-002");
        assert.equal(passedPayload.role, "Core C# Developer");
        assert.deepEqual(passedPayload.topics, ["DOTNET", "CSHARP", "ASPNET"]);
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createCustomInterview = origCreateCustom;
      }
    });
  });
});
