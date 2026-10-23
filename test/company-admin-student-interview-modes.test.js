import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TestSeries from "../src/models/testSeries.model.js";
import CompanyTrackAttempt from "../src/models/companyTrackAttempt.model.js";
import InterviewSession from "../src/ai-interview/schemas/interview-session.schema.js";
import {
  createTestSeriesSchema,
  updateTestSeriesSchema,
  hiringRoundSchema,
} from "../src/modules/test-management/schemas/testSeries.schema.js";
import {
  normalizeTrackRounds,
  launchCompanyInterviewRound,
  updateTrackAttemptFromInterviewSession,
  getTrackAttemptStatus,
} from "../src/modules/company-exams/companyExam.service.js";
import { interviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { resumeService } from "../src/ai-interview/resume/resume.service.js";

const { Types } = mongoose;

describe("Comprehensive E2E Testing: Admin Track Builder & Student Interview Experience", () => {
  const dummyUserId = new Types.ObjectId();
  const dummyCompanyId = new Types.ObjectId();
  const dummyTrackId = new Types.ObjectId();

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION 1: ADMIN-SIDE TESTING (ROUND CREATION, SCHEMAS & CONFIGURATION)
     ══════════════════════════════════════════════════════════════════════════ */
  describe("1. Admin-Side: Process Creation with Predefined, Resume-Based, and Hybrid Modes", () => {
    test("1.1 Admin configures PREDEFINED Standard AI Interview round", () => {
      const predefinedRound = {
        roundOrder: 1,
        roundKey: "ROUND_PREDEFINED_ARCH",
        roundName: "Staff Frontend Architect Interview",
        roundType: "AI_INTERVIEW",
        cutoffPercentage: 70,
        weight: 100,
        aiInterviewConfig: {
          interviewMode: "PREDEFINED",
          role: "Staff Frontend Architect",
          difficulty: "HARD",
          duration: 45,
          durationMinutes: 45,
          topics: ["REACT", "TYPESCRIPT", "MICRO_FRONTENDS", "WEB_PERFORMANCE"],
          customRubric: "Evaluate deep architectural mastery, React Fiber internals, and SSR caching strategies.",
          allowResumeUpload: false,
          requireResume: false,
        },
      };

      const parseResult = hiringRoundSchema.safeParse(predefinedRound);
      assert.equal(parseResult.success, true, "Round schema must validate PREDEFINED mode");
      assert.equal(parseResult.data.aiInterviewConfig.interviewMode, "PREDEFINED");
      assert.equal(parseResult.data.aiInterviewConfig.allowResumeUpload, false);
      assert.equal(parseResult.data.aiInterviewConfig.requireResume, false);
      assert.equal(parseResult.data.aiInterviewConfig.durationMinutes, 45);
      assert.equal(parseResult.data.aiInterviewConfig.topics.length, 4);

      // Verify track series schema integration
      const trackPayload = {
        title: "Staff Frontend Campus Drive 2026",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        experienceLevel: "EXPERIENCED_3_PLUS",
        targetRole: "Staff Frontend Architect",
        patternVersion: "2026",
        hiringRounds: [predefinedRound],
      };

      const trackParseResult = createTestSeriesSchema.safeParse(trackPayload);
      assert.equal(trackParseResult.success, true, "createTestSeriesSchema must accept PREDEFINED AI round");
    });

    test("1.2 Admin configures RESUME_BASED AI Interview round with mandatory resume upload", () => {
      const resumeBasedRound = {
        roundOrder: 1,
        roundKey: "ROUND_RESUME_PROBE",
        roundName: "Deep Resume Grounded Evaluation",
        roundType: "AI_INTERVIEW",
        cutoffPercentage: 65,
        aiInterviewConfig: {
          interviewMode: "RESUME_BASED",
          role: "Full Stack Engineer",
          difficulty: "MEDIUM",
          duration: 30,
          durationMinutes: 30,
          allowResumeUpload: true,
          requireResume: true,
          customRubric: "Probe candidate on listed production deployments, system bottlenecks, and technical trade-offs.",
          topics: [],
        },
      };

      const parseResult = hiringRoundSchema.safeParse(resumeBasedRound);
      assert.equal(parseResult.success, true, "Round schema must validate RESUME_BASED mode");
      assert.equal(parseResult.data.aiInterviewConfig.interviewMode, "RESUME_BASED");
      assert.equal(parseResult.data.aiInterviewConfig.requireResume, true);
      assert.equal(parseResult.data.aiInterviewConfig.allowResumeUpload, true);

      // Verify normalization maintains resume requirement
      const normalized = normalizeTrackRounds({ hiringRounds: [resumeBasedRound] });
      assert.equal(normalized[0].aiInterviewConfig.interviewMode, "RESUME_BASED");
      assert.equal(normalized[0].aiInterviewConfig.requireResume, true);
      assert.equal(normalized[0].aiInterviewConfig.allowResumeUpload, true);
    });

    test("1.3 Admin configures HYBRID AI Interview round with company focus topics and optional/mandatory resume", () => {
      const hybridRound = {
        roundOrder: 2,
        roundKey: "ROUND_HYBRID_DATA",
        roundName: "Data Platform Engineering (Hybrid)",
        roundType: "AI_INTERVIEW",
        cutoffPercentage: 75,
        aiInterviewConfig: {
          interviewMode: "HYBRID",
          role: "Cloud Data Engineer",
          difficulty: "HARD",
          duration: 40,
          durationMinutes: 40,
          topics: ["APACHE_KAFKA", "SNOWFLAKE", "DISTRIBUTED_SYSTEMS"],
          customRubric: "Examine candidate on real-time streaming architectures alongside their claimed project experience.",
          allowResumeUpload: true,
          requireResume: false, // Optional resume for hybrid
        },
      };

      const parseResult = hiringRoundSchema.safeParse(hybridRound);
      assert.equal(parseResult.success, true, "Round schema must validate HYBRID mode");
      assert.equal(parseResult.data.aiInterviewConfig.interviewMode, "HYBRID");
      assert.equal(parseResult.data.aiInterviewConfig.allowResumeUpload, true);
      assert.equal(parseResult.data.aiInterviewConfig.requireResume, false);
      assert.equal(parseResult.data.aiInterviewConfig.topics.includes("APACHE_KAFKA"), true);

      const normalized = normalizeTrackRounds({ hiringRounds: [hybridRound] });
      assert.equal(normalized[0].aiInterviewConfig.interviewMode, "HYBRID");
      assert.equal(normalized[0].aiInterviewConfig.topics.length, 3);
    });

    test("1.4 Admin validation guards reject invalid configurations", () => {
      // Rejects invalid interview mode
      const invalidMode = {
        roundOrder: 1,
        roundKey: "R1",
        roundName: "Invalid Round",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "UNKNOWN_MODE",
          role: "Developer",
        },
      };
      const res1 = hiringRoundSchema.safeParse(invalidMode);
      assert.equal(res1.success, false, "Must reject unsupported interviewMode");

      // Rejects invalid difficulty
      const invalidDifficulty = {
        roundOrder: 1,
        roundKey: "R2",
        roundName: "Invalid Difficulty Round",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "PREDEFINED",
          role: "Software Engineer",
          difficulty: "SUPER_HARD",
        },
      };
      const res2 = hiringRoundSchema.safeParse(invalidDifficulty);
      assert.equal(res2.success, false, "Must reject invalid difficulty");

      // Rejects durationMinutes out of allowed bounds (5 - 180)
      const invalidDuration = {
        roundOrder: 1,
        roundKey: "R2B",
        roundName: "Invalid Duration Round",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "PREDEFINED",
          role: "Software Engineer",
          durationMinutes: 999,
        },
      };
      const res2b = hiringRoundSchema.safeParse(invalidDuration);
      assert.equal(res2b.success, false, "Must reject durationMinutes > 180");

      // Rejects requireResume: true when allowResumeUpload: false
      const conflictingResumePolicy = {
        roundOrder: 1,
        roundKey: "R3",
        roundName: "Conflicting Policy Round",
        roundType: "AI_INTERVIEW",
        aiInterviewConfig: {
          interviewMode: "RESUME_BASED",
          role: "Developer",
          allowResumeUpload: false,
          requireResume: true,
        },
      };
      const res3 = hiringRoundSchema.safeParse(conflictingResumePolicy);
      assert.equal(res3.success, false, "Must reject requireResume=true if allowResumeUpload=false");
    });

    test("1.5 Admin track update preserves and updates AI interview round configs", () => {
      const updatePayload = {
        title: "Updated Cloud Architecture Track",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_UPDATED",
            roundName: "Updated AI Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70,
            aiInterviewConfig: {
              interviewMode: "HYBRID",
              role: "Principal Architect",
              difficulty: "HARD",
              duration: 60,
              durationMinutes: 60,
              topics: ["SYSTEM_DESIGN", "KUBERNETES", "EVENT_DRIVEN"],
              allowResumeUpload: true,
              requireResume: true,
              customRubric: "Strict evaluation on fault tolerance and scale.",
            },
          },
        ],
      };

      const parseResult = updateTestSeriesSchema.safeParse(updatePayload);
      assert.equal(parseResult.success, true, "updateTestSeriesSchema must validate updated AI round");
      assert.equal(parseResult.data.hiringRounds[0].aiInterviewConfig.interviewMode, "HYBRID");
      assert.equal(parseResult.data.hiringRounds[0].aiInterviewConfig.durationMinutes, 60);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION 2: STUDENT-SIDE TESTING (INTERVIEW LAUNCH, RESUME & PROGRESSION)
     ══════════════════════════════════════════════════════════════════════════ */
  describe("2. Student-Side: Launching Predefined, Resume-Based, and Hybrid Interviews", () => {
    test("2.1 Student launches PREDEFINED interview directly without resume", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origCreateCustom = interviewSessionService.createCustomInterview;

      let customPayloadPassed = null;
      interviewSessionService.createCustomInterview = async (userId, payload) => {
        customPayloadPassed = payload;
        return {
          interviewId: "session-predefined-direct-001",
          role: payload.role,
          status: "IN_PROGRESS",
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
            roundKey: "ROUND_PREDEFINED",
            roundName: "Predefined Systems Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70,
            aiInterviewConfig: {
              interviewMode: "PREDEFINED",
              role: "Distributed Systems SDE II",
              difficulty: "HARD",
              duration: 45,
              durationMinutes: 45,
              topics: ["CONCURRENCY", "RAFT_CONSENSUS", "DYNAMODB"],
              customRubric: "Assess distributed consensus algorithms.",
              allowResumeUpload: false,
              requireResume: false,
            },
          },
        ],
      };

      let attemptSaved = false;
      const mockAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          { roundOrder: 1, status: "READY", interviewSessionId: null },
        ],
        save: async function () {
          attemptSaved = true;
          return this;
        },
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

        assert.ok(result);
        assert.equal(result.interviewId, "session-predefined-direct-001");
        assert.equal(attemptSaved, true, "Track attempt must be updated and saved");
        assert.equal(mockAttempt.roundAttempts[0].status, "IN_PROGRESS");
        assert.equal(mockAttempt.roundAttempts[0].interviewSessionId, "session-predefined-direct-001");

        // Verify payload passed to session creation
        assert.equal(customPayloadPassed.role, "Distributed Systems SDE II");
        assert.equal(customPayloadPassed.difficulty, "HARD");
        assert.equal(customPayloadPassed.duration, 45);
        assert.deepEqual(customPayloadPassed.topics, ["CONCURRENCY", "RAFT_CONSENSUS", "DYNAMODB"]);
        assert.equal(customPayloadPassed.customRubric, "Assess distributed consensus algorithms.");
        assert.equal(String(customPayloadPassed.trackId), String(dummyTrackId));
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createCustomInterview = origCreateCustom;
      }
    });

    test("2.2 Student launches RESUME_BASED interview with multipart uploaded file", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origCreateResume = interviewSessionService.createResumeInterview;

      let resumePayloadPassed = null;
      let resumeFilePassed = null;

      interviewSessionService.createResumeInterview = async (userId, file, payload) => {
        resumeFilePassed = file;
        resumePayloadPassed = payload;
        return {
          interviewId: "session-resume-file-002",
          role: payload.role,
          status: "IN_PROGRESS",
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        companyId: { _id: dummyCompanyId, name: "Google" },
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_RESUME_PROBE",
            roundName: "Resume Deep Dive",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 65,
            aiInterviewConfig: {
              interviewMode: "RESUME_BASED",
              role: "Full Stack Engineer",
              difficulty: "INTERMEDIATE",
              duration: 30,
              allowResumeUpload: true,
              requireResume: true,
              customRubric: "Investigate candidate's production microservices experience.",
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

      const mockResumeFile = {
        buffer: Buffer.from("%PDF-1.4 Mock resume content for testing"),
        originalname: "alex_developer_resume.pdf",
        mimetype: "application/pdf",
        size: 1024,
      };

      try {
        const result = await launchCompanyInterviewRound({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
          file: mockResumeFile,
          body: {},
        });

        assert.ok(result);
        assert.equal(result.interviewId, "session-resume-file-002");
        assert.equal(resumeFilePassed.originalname, "alex_developer_resume.pdf");
        assert.equal(resumePayloadPassed.role, "Full Stack Engineer");
        assert.equal(resumePayloadPassed.customRubric, "Investigate candidate's production microservices experience.");
        assert.equal(String(resumePayloadPassed.trackId), String(dummyTrackId));
        assert.equal(mockAttempt.roundAttempts[0].status, "IN_PROGRESS");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createResumeInterview = origCreateResume;
      }
    });

    test("2.3 Student launches RESUME_BASED interview with saved resume ID", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origCreateResume = interviewSessionService.createResumeInterview;

      let passedResumePayload = null;
      interviewSessionService.createResumeInterview = async (userId, file, payload) => {
        passedResumePayload = payload;
        return {
          interviewId: "session-saved-resume-003",
          role: payload.role,
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        companyId: { _id: dummyCompanyId, name: "Meta" },
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_SAVED_RES",
            roundName: "Resume Evaluation",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 60,
            aiInterviewConfig: {
              interviewMode: "RESUME_BASED",
              role: "iOS Engineer",
              allowResumeUpload: true,
              requireResume: true,
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
          file: null,
          body: { resumeId: "saved-resume-doc-xyz" },
        });

        assert.ok(result);
        assert.equal(result.interviewId, "session-saved-resume-003");
        assert.equal(passedResumePayload.resumeId, "saved-resume-doc-xyz");
        assert.equal(passedResumePayload.role, "iOS Engineer");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createResumeInterview = origCreateResume;
      }
    });

    test("2.4 Student launches RESUME_BASED interview with profile resume fallback", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origCreateResume = interviewSessionService.createResumeInterview;
      const origGetLatest = resumeService.getLatestForUser;

      const profileResumeId = new Types.ObjectId();
      resumeService.getLatestForUser = async (userId) => ({
        _id: profileResumeId,
        resumeId: `resume-profile-${profileResumeId.toString()}`,
        fileName: "profile_saved_resume.pdf",
      });

      let passedPayload = null;
      interviewSessionService.createResumeInterview = async (userId, file, payload) => {
        passedPayload = payload;
        return {
          interviewId: "session-fallback-profile-004",
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_RESUME_FALLBACK",
            roundName: "Resume Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 60,
            aiInterviewConfig: {
              interviewMode: "RESUME_BASED",
              role: "Data Analyst",
              requireResume: true,
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
          file: null,
          body: {}, // No file and no explicit resumeId provided
        });

        assert.ok(result);
        assert.equal(result.interviewId, "session-fallback-profile-004");
        assert.equal(String(passedPayload.resumeId), `resume-profile-${profileResumeId.toString()}`, "Must fallback to profile resume");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createResumeInterview = origCreateResume;
        resumeService.getLatestForUser = origGetLatest;
      }
    });

    test("2.5 Student launch is blocked when resume is mandatory and candidate has none", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origGetLatest = resumeService.getLatestForUser;

      resumeService.getLatestForUser = async () => null; // No profile resume

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_STRICT_RESUME",
            roundName: "Strict Resume Verification",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70,
            aiInterviewConfig: {
              interviewMode: "RESUME_BASED",
              role: "Security Engineer",
              requireResume: true,
              allowResumeUpload: true,
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
              body: {},
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

    test("2.6 Student launches HYBRID interview combining company topics and uploaded resume", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origCreateResume = interviewSessionService.createResumeInterview;

      let passedPayload = null;
      interviewSessionService.createResumeInterview = async (userId, file, payload) => {
        passedPayload = payload;
        return {
          interviewId: "session-hybrid-launch-005",
          role: payload.role,
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_HYBRID_COMBINED",
            roundName: "Hybrid AI Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70,
            aiInterviewConfig: {
              interviewMode: "HYBRID",
              role: "Senior Cloud Architect",
              topics: ["KUBERNETES", "TERRAFORM", "AWS"],
              customRubric: "Validate both cloud infra fundamentals and past enterprise migration stories.",
              allowResumeUpload: true,
              requireResume: true,
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

      const mockFile = {
        buffer: Buffer.from("Cloud Architect resume"),
        originalname: "cloud_arch.pdf",
        mimetype: "application/pdf",
      };

      try {
        const result = await launchCompanyInterviewRound({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
          file: mockFile,
        });

        assert.ok(result);
        assert.equal(result.interviewId, "session-hybrid-launch-005");
        assert.deepEqual(passedPayload.topics, ["KUBERNETES", "TERRAFORM", "AWS"]);
        assert.equal(passedPayload.customRubric, "Validate both cloud infra fundamentals and past enterprise migration stories.");
        assert.equal(passedPayload.role, "Senior Cloud Architect");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createResumeInterview = origCreateResume;
      }
    });

    test("2.7 Student launches HYBRID interview with optional resume fallback to custom interview", async () => {
      const origTrackFindById = TestSeries.findById;
      const origTrackAttemptFindOne = CompanyTrackAttempt.findOne;
      const origCreateCustom = interviewSessionService.createCustomInterview;
      const origGetLatest = resumeService.getLatestForUser;

      resumeService.getLatestForUser = async () => null; // No resume

      let passedCustomPayload = null;
      interviewSessionService.createCustomInterview = async (userId, payload) => {
        passedCustomPayload = payload;
        return {
          interviewId: "session-hybrid-optional-fallback-006",
        };
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        isPublished: true,
        isDeleted: false,
        progressionMode: "OPEN",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_HYBRID_OPTIONAL",
            roundName: "Hybrid Optional Resume Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 60,
            aiInterviewConfig: {
              interviewMode: "HYBRID",
              role: "Go Microservices Developer",
              topics: ["GOLANG", "GPRC", "REDIS"],
              allowResumeUpload: true,
              requireResume: false, // Optional
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
          file: null,
          body: {},
        });

        assert.ok(result);
        assert.equal(result.interviewId, "session-hybrid-optional-fallback-006");
        assert.equal(passedCustomPayload.role, "Go Microservices Developer");
        assert.deepEqual(passedCustomPayload.topics, ["GOLANG", "GPRC", "REDIS"]);
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origTrackAttemptFindOne;
        interviewSessionService.createCustomInterview = origCreateCustom;
        resumeService.getLatestForUser = origGetLatest;
      }
    });

    test("2.8 Student completes interview and qualifies round when cutoff percentage is met", async () => {
      const origSessionFindOne = InterviewSession.findOne;
      const origAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;

      const mockSession = {
        _id: new Types.ObjectId(),
        interviewId: "session-completed-007",
        userId: dummyUserId,
        interviewState: "COMPLETED",
        trackId: dummyTrackId,
        trackAttemptId: new Types.ObjectId(),
        companyRoundOrder: 1,
        evaluation: {
          overallScore: 82, // Score is 82%
        },
        resultsSummary: {
          score: 82,
        },
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        progressionMode: "SEQUENTIAL",
        passingPercentage: 60,
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1_AI",
            roundName: "AI Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70, // 82 >= 70 => PASSED
          },
          {
            roundOrder: 2,
            roundKey: "ROUND_2_SYSTEM",
            roundName: "System Architecture Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 65,
          },
        ],
      };

      let attemptSaved = false;
      const mockAttempt = {
        _id: mockSession.trackAttemptId,
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          {
            roundOrder: 1,
            status: "IN_PROGRESS",
            interviewSessionId: "session-completed-007",
            score: null,
          },
          {
            roundOrder: 2,
            status: "LOCKED",
            interviewSessionId: null,
            score: null,
          },
        ],
        save: async function () {
          attemptSaved = true;
          return this;
        },
      };

      InterviewSession.findOne = () => mockSession;
      CompanyTrackAttempt.findById = () => mockAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });

      try {
        const updateResult = await updateTrackAttemptFromInterviewSession("session-completed-007", { score: 82 });
        assert.ok(updateResult);
        assert.equal(attemptSaved, true, "Attempt must be saved upon interview completion");
        assert.equal(mockAttempt.roundAttempts[0].status, "PASSED", "Round 1 must be marked PASSED");
        assert.equal(mockAttempt.roundAttempts[0].percentage, 82);
        assert.equal(mockAttempt.roundAttempts[0].scoreObtained, 82);
        assert.equal(mockAttempt.roundAttempts[1].status, "READY", "Round 2 must be unlocked to READY in SEQUENTIAL mode");
      } finally {
        InterviewSession.findOne = origSessionFindOne;
        CompanyTrackAttempt.findById = origAttemptFindById;
        TestSeries.findById = origTrackFindById;
      }
    });
  });
});
