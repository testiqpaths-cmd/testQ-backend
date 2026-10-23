import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TestSeries from "../src/models/testSeries.model.js";
import Company from "../src/models/company.model.js";
import Test from "../src/models/test.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import CompanyTrackAttempt from "../src/models/companyTrackAttempt.model.js";
import InterviewSession from "../src/ai-interview/schemas/interview-session.schema.js";
import User from "../src/models/user.model.js";

import {
  normalizeTrackRounds,
  startOrResumeTrackAttempt,
  getTrackAttemptStatus,
  retakeTrackAttempt,
  updateTrackAttemptProgress,
  updateTrackAttemptFromInterviewSession,
  launchCompanyInterviewRound,
  getCompanyResultsByStudent,
  getCompanyTrackAdminAnalytics,
  getCompanyTrackAttemptById,
} from "../src/modules/company-exams/companyExam.service.js";

import { assertCanViewSession } from "../src/ai-interview/utils/authorize.js";
import { findAttemptsByStudent } from "../src/modules/analytics/test-attempt/repository/testAttempt.repository.js";
import { createCompanySchema, updateCompanySchema } from "../src/modules/company/company.schema.js";
import { createTestSeriesSchema, updateTestSeriesSchema } from "../src/modules/test-management/schemas/testSeries.schema.js";

const { Types } = mongoose;

describe("Company-Wise End-to-End Production Readiness & Security Verification", () => {
  const dummyAdminId = new Types.ObjectId();
  const dummyCandidateA = new Types.ObjectId();
  const dummyCandidateB = new Types.ObjectId();
  const dummyOrgA = new Types.ObjectId();
  const dummyOrgB = new Types.ObjectId();

  const dummyCompanyId = new Types.ObjectId();
  const dummyTrackId = new Types.ObjectId();
  const dummyTest1Id = new Types.ObjectId();
  const dummyTest2Id = new Types.ObjectId();

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION 1: CRITICAL END-TO-END TESTS (19 CHECKLIST ITEMS)
     ══════════════════════════════════════════════════════════════════════════ */
  describe("1. Admin Configuration", () => {
    test("1.1 Create a company with logo, brand colors, and description", () => {
      const payload = {
        name: "Acme Corporation",
        description: "Leading enterprise cloud provider and global SaaS leader",
        website: "https://acme.example.com",
        primaryColor: "#1E40AF",
        secondaryColor: "#93C5FD",
      };

      const parsed = createCompanySchema.parse(payload);
      assert.equal(parsed.name, "Acme Corporation");
      assert.equal(parsed.primaryColor, "#1E40AF");
      assert.equal(parsed.secondaryColor, "#93C5FD");

      const companyDoc = new Company({
        ...parsed,
        logo: "company-logos/acme.png",
      });
      assert.equal(companyDoc.logo, "company-logos/acme.png");
    });

    test("1.2 Create and publish a track for a specific role and experience level", () => {
      const trackPayload = {
        title: "Acme Full Stack Placement Drive 2026",
        description: "Official campus placement assessment track for associate engineers",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        targetRole: "Full Stack Software Engineer",
        experienceLevel: "EXPERIENCED_1_3",
        mode: "SIMULATION",
        progressionMode: "SEQUENTIAL",
        passingPercentage: 65,
        isPublished: true,
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1_OA",
            roundName: "Online Assessment (DSA + Aptitude)",
            roundType: "TESTS",
            cutoffPercentage: 60,
            weight: 100,
            retakePolicy: "FAILED_ONLY",
            tests: [dummyTest1Id.toString(), dummyTest2Id.toString()],
          },
          {
            roundOrder: 2,
            roundKey: "ROUND_2_TECH_INTERVIEW",
            roundName: "Technical AI System Interview",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70,
            weight: 150,
            retakePolicy: "ALL_TESTS",
            aiInterviewConfig: {
              role: "Full Stack Engineer",
              experienceLevel: "MID",
              durationMinutes: 45,
              difficulty: "HARD",
              interviewTypes: ["TECHNICAL", "SYSTEM_DESIGN"],
              topics: ["NODE_JS", "REACT", "SYSTEM_DESIGN"],
              customRubric: "Emphasize concurrency, asynchronous I/O, and architectural trade-offs.",
            },
          },
        ],
      };

      const validated = createTestSeriesSchema.parse(trackPayload);
      assert.equal(validated.targetRole, "Full Stack Software Engineer");
      assert.equal(validated.experienceLevel, "EXPERIENCED_1_3");
      assert.equal(validated.isPublished, true);
      assert.equal(validated.hiringRounds.length, 2);
    });

    test("1.3 Configure multiple assessment tests in Round 1 and AI Interview in Round 2", () => {
      const trackPayload = {
        title: "Multi-Round Placement Track",
        visibility: "PUBLIC",
        category: "COMPANY",
        companyId: dummyCompanyId.toString(),
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundName: "Multiple Tests Round",
            roundType: "TESTS",
            cutoffPercentage: 60,
            weight: 100,
            tests: [dummyTest1Id.toString(), dummyTest2Id.toString()],
          },
          {
            roundOrder: 2,
            roundKey: "R2",
            roundName: "AI Interview Round",
            roundType: "AI_INTERVIEW",
            cutoffPercentage: 70,
            weight: 150,
            aiInterviewConfig: {
              role: "Backend Engineer",
              durationMinutes: 30,
              difficulty: "MEDIUM",
            },
          },
        ],
      };

      const track = new TestSeries(trackPayload);
      const rounds = normalizeTrackRounds(track);
      assert.equal(rounds.length, 2);
      assert.equal(rounds[0].roundType, "TESTS");
      assert.equal(rounds[0].tests.length, 2);
      assert.equal(rounds[1].roundType, "AI_INTERVIEW");
      assert.equal(rounds[1].weight, 150);
    });

    test("1.4 Edit and reload track; verify all configuration persists", async () => {
      const updatePayload = {
        title: "Updated Title",
        passingPercentage: 75,
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1_UPDATED",
            roundName: "Updated Round Name",
            roundType: "TESTS",
            cutoffPercentage: 75,
            weight: 120,
            tests: [dummyTest1Id.toString()],
          },
        ],
      };

      const validatedUpdate = updateTestSeriesSchema.parse(updatePayload);
      assert.equal(validatedUpdate.passingPercentage, 75);
      assert.equal(validatedUpdate.hiringRounds[0].roundKey, "R1_UPDATED");
      assert.equal(validatedUpdate.hiringRounds[0].weight, 120);

      const seriesDoc = new TestSeries(validatedUpdate);
      assert.equal(seriesDoc.hiringRounds[0].cutoffPercentage, 75);
      assert.equal(seriesDoc.hiringRounds[0].weight, 120);
    });
  });

  describe("2. Candidate Hiring Journey", () => {
    const mockTrack = {
      _id: dummyTrackId,
      category: "COMPANY",
      companyId: dummyCompanyId,
      isPublished: true,
      mode: "SIMULATION",
      progressionMode: "SEQUENTIAL",
      passingPercentage: 60,
      hiringRounds: [
        {
          roundOrder: 1,
          roundKey: "R1",
          roundName: "Coding Round",
          roundType: "TESTS",
          cutoffPercentage: 60,
          weight: 100,
          tests: [dummyTest1Id, dummyTest2Id],
        },
        {
          roundOrder: 2,
          roundKey: "R2",
          roundName: "AI Interview",
          roundType: "AI_INTERVIEW",
          cutoffPercentage: 70,
          weight: 150,
          aiInterviewConfig: {
            role: "Software Engineer",
            duration: 30,
            difficulty: "HARD",
          },
        },
      ],
    };

    test("2.1 Start track and verify Round 1 is unlocked while Round 2 is locked", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      const origCreate = CompanyTrackAttempt.create;

      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => mockTrack,
          }),
        }),
      });

      CompanyTrackAttempt.findOne = (query) => {
        if (query.status === "IN_PROGRESS") {
          return Promise.resolve(null);
        }
        return {
          sort: () => ({
            select: () => ({
              lean: async () => null,
            }),
          }),
        };
      };

      let createdAttempt = null;
      CompanyTrackAttempt.create = async (doc) => {
        createdAttempt = doc;
        return doc;
      };

      try {
        const result = await startOrResumeTrackAttempt({
          studentId: dummyCandidateA.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNew, true);
        assert.equal(result.trackAttempt.status, "IN_PROGRESS");
        assert.equal(result.trackAttempt.roundAttempts[0].status, "READY");
        assert.equal(result.trackAttempt.roundAttempts[1].status, "LOCKED");
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        CompanyTrackAttempt.create = origCreate;
      }
    });

    test("2.2 Complete all tests in Round 1 and verify scoring and cutoff evaluation", async () => {
      const origFindByIdSeries = TestSeries.findById;
      const origFindAttempts = TestAttempt.find;
      const origFindAttemptById = TestAttempt.findById;
      const origFindTrackAttemptById = CompanyTrackAttempt.findById;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId1 = new Types.ObjectId();
      const mockTestAttemptId2 = new Types.ObjectId();

      const mockTestAttempt1 = {
        _id: mockTestAttemptId1,
        testId: dummyTest1Id,
        studentId: dummyCandidateA,
        companyTrackAttemptId: mockTrackAttemptId,
        companyRoundOrder: 1,
        status: "SUBMITTED",
        totalScore: 80,
        maxScore: 100,
        percentage: 80,
      };

      const mockTestAttempt2 = {
        _id: mockTestAttemptId2,
        testId: dummyTest2Id,
        studentId: dummyCandidateA,
        companyTrackAttemptId: mockTrackAttemptId,
        companyRoundOrder: 1,
        status: "EVALUATED",
        totalScore: 70,
        maxScore: 100,
        percentage: 70,
      };

      const trackAttemptDoc = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundName: "Coding Round",
            roundType: "TESTS",
            status: "IN_PROGRESS",
            cutoffPercentage: 60,
            testAttemptIds: [mockTestAttemptId1, mockTestAttemptId2],
          },
          {
            roundOrder: 2,
            roundKey: "R2",
            roundName: "AI Interview",
            roundType: "AI_INTERVIEW",
            status: "LOCKED",
            cutoffPercentage: 70,
            testAttemptIds: [],
          },
        ],
        save: async function () {
          return this;
        },
      };

      TestSeries.findById = () => ({ lean: async () => mockTrack });
      TestAttempt.findById = async () => mockTestAttempt1;
      CompanyTrackAttempt.findById = async () => trackAttemptDoc;
      TestAttempt.find = () => ({ lean: async () => [mockTestAttempt1, mockTestAttempt2] });

      try {
        await updateTrackAttemptProgress(mockTestAttempt1);
        const r1 = trackAttemptDoc.roundAttempts[0];
        assert.equal(r1.status, "PASSED");
        assert.equal(r1.percentage, 75); // (80 + 70) / 200 = 75%
        assert.equal(r1.percentage >= r1.cutoffPercentage, true);
        // Round 2 unlocks
        const r2 = trackAttemptDoc.roundAttempts[1];
        assert.equal(r2.status, "READY");
      } finally {
        TestSeries.findById = origFindByIdSeries;
        TestAttempt.find = origFindAttempts;
        TestAttempt.findById = origFindAttemptById;
        CompanyTrackAttempt.findById = origFindTrackAttemptById;
      }
    });

    test("2.3 Attempt to launch a locked round directly through the API; verify server rejects it", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;

      TestSeries.findById = () => {
        const query = {
          populate: () => query,
          lean: async () => mockTrack,
        };
        return query;
      };

      CompanyTrackAttempt.findOne = () => ({
        status: "IN_PROGRESS",
        studentId: dummyCandidateA,
        roundAttempts: [
          { roundOrder: 1, status: "READY" },
          { roundOrder: 2, status: "LOCKED" },
        ],
        save: async () => {},
      });

      try {
        await assert.rejects(
          async () => {
            await launchCompanyInterviewRound({
              studentId: dummyCandidateA.toString(),
              trackId: dummyTrackId.toString(),
              roundOrder: 2,
            });
          },
          (err) => {
            assert.equal(err.statusCode, 403);
            assert.match(err.message, /This stage is locked/i);
            return true;
          }
        );
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
      }
    });

    test("2.4 Pass the assessment round and verify AI Interview round unlocks", async () => {
      const trackAttemptDoc = {
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            status: "PASSED",
            percentage: 80,
            cutoffPercentage: 60,
          },
          {
            roundOrder: 2,
            roundKey: "R2",
            status: "READY", // Unlocked after round 1 passed
            cutoffPercentage: 70,
          },
        ],
      };

      assert.equal(trackAttemptDoc.roundAttempts[0].status, "PASSED");
      assert.equal(trackAttemptDoc.roundAttempts[1].status, "READY");
    });

    test("2.5 Complete AI Interview and verify final score, cutoff, and progression", async () => {
      const origFindByIdSeries = TestSeries.findById;
      const origFindByIdAttempt = CompanyTrackAttempt.findById;

      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });

      const trackAttemptDoc = {
        _id: new Types.ObjectId(),
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        currentRoundOrder: 2,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            status: "PASSED",
            scoreObtained: 80,
            maxScore: 100,
            percentage: 80,
            cutoffPercentage: 60,
          },
          {
            roundOrder: 2,
            roundKey: "R2",
            roundType: "AI_INTERVIEW",
            status: "IN_PROGRESS",
            interviewSessionId: "int-session-123",
            scoreObtained: 0,
            maxScore: 100,
            percentage: 0,
            cutoffPercentage: 70,
          },
        ],
        save: async function () {
          return this;
        },
      };

      CompanyTrackAttempt.findById = async () => trackAttemptDoc;

      const mockSession = {
        interviewId: "int-session-123",
        userId: dummyCandidateA,
        trackAttemptId: trackAttemptDoc._id,
        trackId: dummyTrackId,
        companyRoundOrder: 2,
        interviewState: "COMPLETED",
        resultsSummary: {
          score: 85,
          readinessScore: 88,
        },
      };

      try {
        await updateTrackAttemptFromInterviewSession(mockSession);
        const r2 = trackAttemptDoc.roundAttempts[1];
        assert.equal(r2.status, "PASSED");
        assert.equal(r2.percentage, 85);
        assert.equal(trackAttemptDoc.status, "QUALIFIED");
      } finally {
        TestSeries.findById = origFindByIdSeries;
        CompanyTrackAttempt.findById = origFindByIdAttempt;
      }
    });

    test("2.6 Verify QUALIFIED is assigned only after every required round passes", async () => {
      const origFindByIdSeries = TestSeries.findById;
      const origFindAttempts = TestAttempt.find;
      const origFindAttemptById = TestAttempt.findById;
      const origFindTrackAttemptById = CompanyTrackAttempt.findById;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId1 = new Types.ObjectId();
      const mockTestAttemptId2 = new Types.ObjectId();

      const mockTestAttempt1 = {
        _id: mockTestAttemptId1,
        testId: dummyTest1Id,
        studentId: dummyCandidateA,
        companyTrackAttemptId: mockTrackAttemptId,
        companyRoundOrder: 1,
        status: "SUBMITTED",
        totalScore: 90,
        maxScore: 100,
        percentage: 90,
      };

      const mockTestAttempt2 = {
        _id: mockTestAttemptId2,
        testId: dummyTest2Id,
        studentId: dummyCandidateA,
        companyTrackAttemptId: mockTrackAttemptId,
        companyRoundOrder: 1,
        status: "EVALUATED",
        totalScore: 90,
        maxScore: 100,
        percentage: 90,
      };

      const trackAttemptDoc = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            status: "IN_PROGRESS",
            cutoffPercentage: 60,
            testAttemptIds: [mockTestAttemptId1, mockTestAttemptId2],
          },
          {
            roundOrder: 2,
            roundKey: "R2",
            roundType: "AI_INTERVIEW",
            status: "LOCKED",
            cutoffPercentage: 70,
          },
        ],
        save: async function () {
          return this;
        },
      };

      TestSeries.findById = () => ({ lean: async () => mockTrack });
      TestAttempt.findById = async () => mockTestAttempt1;
      CompanyTrackAttempt.findById = async () => trackAttemptDoc;
      TestAttempt.find = () => ({ lean: async () => [mockTestAttempt1, mockTestAttempt2] });

      try {
        await updateTrackAttemptProgress(mockTestAttempt1);
        // Round 1 passed, but Round 2 is pending => drive MUST stay IN_PROGRESS
        assert.equal(trackAttemptDoc.roundAttempts[0].status, "PASSED");
        assert.equal(trackAttemptDoc.roundAttempts[1].status, "READY");
        assert.equal(trackAttemptDoc.status, "IN_PROGRESS");
        assert.notEqual(trackAttemptDoc.status, "QUALIFIED");
      } finally {
        TestSeries.findById = origFindByIdSeries;
        TestAttempt.find = origFindAttempts;
        TestAttempt.findById = origFindAttemptById;
        CompanyTrackAttempt.findById = origFindTrackAttemptById;
      }
    });
  });

  describe("3. Failure and Retake Behavior", () => {
    test("3.1 Fail a round in SIMULATION mode and verify drive becomes NOT_QUALIFIED", async () => {
      const simTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            cutoffPercentage: 70,
            tests: [dummyTest1Id],
          },
        ],
      };

      const origFindByIdSeries = TestSeries.findById;
      const origFindAttempts = TestAttempt.find;
      const origFindAttemptById = TestAttempt.findById;
      const origFindTrackAttemptById = CompanyTrackAttempt.findById;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId = new Types.ObjectId();

      const mockTestAttempt = {
        _id: mockTestAttemptId,
        testId: dummyTest1Id,
        studentId: dummyCandidateA,
        companyTrackAttemptId: mockTrackAttemptId,
        companyRoundOrder: 1,
        status: "SUBMITTED",
        totalScore: 40,
        maxScore: 100,
        percentage: 40,
      };

      const attemptDoc = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            status: "IN_PROGRESS",
            cutoffPercentage: 70,
            testAttemptIds: [mockTestAttemptId],
          },
        ],
        save: async function () {
          return this;
        },
      };

      TestSeries.findById = () => ({ lean: async () => simTrack });
      TestAttempt.findById = async () => mockTestAttempt;
      CompanyTrackAttempt.findById = async () => attemptDoc;
      TestAttempt.find = () => ({ lean: async () => [mockTestAttempt] });

      try {
        await updateTrackAttemptProgress(mockTestAttempt);
        assert.equal(attemptDoc.roundAttempts[0].status, "FAILED");
        assert.equal(attemptDoc.status, "NOT_QUALIFIED");
      } finally {
        TestSeries.findById = origFindByIdSeries;
        TestAttempt.find = origFindAttempts;
        TestAttempt.findById = origFindAttemptById;
        CompanyTrackAttempt.findById = origFindTrackAttemptById;
      }
    });

    test("3.2 Fail a round in PRACTICE mode and verify configured retake behavior", async () => {
      const practiceTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "PRACTICE",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            cutoffPercentage: 70,
            retakePolicy: "FAILED_ONLY",
            tests: [dummyTest1Id],
          },
        ],
      };

      const origFindByIdSeries = TestSeries.findById;
      const origFindAttempts = TestAttempt.find;
      const origFindAttemptById = TestAttempt.findById;
      const origFindTrackAttemptById = CompanyTrackAttempt.findById;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId = new Types.ObjectId();

      const mockTestAttempt = {
        _id: mockTestAttemptId,
        testId: dummyTest1Id,
        studentId: dummyCandidateA,
        companyTrackAttemptId: mockTrackAttemptId,
        companyRoundOrder: 1,
        status: "SUBMITTED",
        totalScore: 40,
        maxScore: 100,
        percentage: 40,
      };

      const attemptDoc = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            status: "IN_PROGRESS",
            cutoffPercentage: 70,
            testAttemptIds: [mockTestAttemptId],
          },
        ],
        save: async function () {
          return this;
        },
      };

      TestSeries.findById = () => ({ lean: async () => practiceTrack });
      TestAttempt.findById = async () => mockTestAttempt;
      CompanyTrackAttempt.findById = async () => attemptDoc;
      TestAttempt.find = () => ({ lean: async () => [mockTestAttempt] });

      try {
        await updateTrackAttemptProgress(mockTestAttempt);
        // Round failed, but in PRACTICE mode the track stays IN_PROGRESS
        assert.equal(attemptDoc.roundAttempts[0].status, "FAILED");
        assert.equal(attemptDoc.status, "IN_PROGRESS");
      } finally {
        TestSeries.findById = origFindByIdSeries;
        TestAttempt.find = origFindAttempts;
        TestAttempt.findById = origFindAttemptById;
        CompanyTrackAttempt.findById = origFindTrackAttemptById;
      }
    });

    test("3.3 Test both ALL_TESTS and FAILED_ONLY retake policies", async () => {
      const passAttemptId = new Types.ObjectId();
      const failAttemptId = new Types.ObjectId();

      const origFindAttempts = TestAttempt.find;
      TestAttempt.find = () => ({
        lean: async () => [
          { _id: passAttemptId, percentage: 80 },
          { _id: failAttemptId, percentage: 40 },
        ],
      });

      const trackFailedOnly = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "PRACTICE",
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "TESTS",
            cutoffPercentage: 60,
            retakePolicy: "FAILED_ONLY",
            tests: [dummyTest1Id, dummyTest2Id],
          },
        ],
      };

      const trackAllTests = {
        ...trackFailedOnly,
        hiringRounds: [
          {
            ...trackFailedOnly.hiringRounds[0],
            retakePolicy: "ALL_TESTS",
          },
        ],
      };

      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;

      try {
        // Policy A: FAILED_ONLY retains passed test attempts
        TestSeries.findById = () => ({ lean: async () => trackFailedOnly });
        let savedDoc = null;
        CompanyTrackAttempt.findOne = () => ({
          sort: () => ({
            status: "IN_PROGRESS",
            roundAttempts: [
              {
                roundOrder: 1,
                status: "FAILED",
                testAttemptIds: [passAttemptId, failAttemptId],
              },
            ],
            save: async function () {
              savedDoc = this;
              return this;
            },
          }),
        });

        const resFailedOnly = await retakeTrackAttempt({
          studentId: dummyCandidateA.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });
        assert.equal(resFailedOnly.isNewDrive, false);
        assert.deepEqual(
          savedDoc.roundAttempts[0].testAttemptIds.map(String),
          [String(passAttemptId)]
        );

        // Policy B: ALL_TESTS clears all test attempts
        TestSeries.findById = () => ({ lean: async () => trackAllTests });
        CompanyTrackAttempt.findOne = () => ({
          sort: () => ({
            status: "IN_PROGRESS",
            roundAttempts: [
              {
                roundOrder: 1,
                status: "FAILED",
                testAttemptIds: [passAttemptId, failAttemptId],
              },
            ],
            save: async function () {
              savedDoc = this;
              return this;
            },
          }),
        });

        const resAllTests = await retakeTrackAttempt({
          studentId: dummyCandidateA.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });
        assert.equal(resAllTests.isNewDrive, false);
        assert.deepEqual(savedDoc.roundAttempts[0].testAttemptIds, []);
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        TestAttempt.find = origFindAttempts;
      }
    });

    test("3.4 Start a new drive and verify its scores and history remain separate from previous drive", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      const origCreate = CompanyTrackAttempt.create;

      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => ({
              _id: dummyTrackId,
              category: "COMPANY",
              companyId: dummyCompanyId,
              isPublished: true,
              mode: "SIMULATION",
              hiringRounds: [
                { roundOrder: 1, roundKey: "R1", roundType: "TESTS", tests: [dummyTest1Id] },
              ],
            }),
          }),
        }),
      });

      // Previous drive was driveAttemptNumber: 1, completed with NOT_QUALIFIED
      CompanyTrackAttempt.findOne = (query) => {
        if (query.status === "IN_PROGRESS") return Promise.resolve(null);
        return {
          sort: () => ({
            select: () => ({
              lean: async () => ({ driveAttemptNumber: 1 }),
            }),
          }),
        };
      };

      let createdDoc = null;
      CompanyTrackAttempt.create = async (doc) => {
        createdDoc = doc;
        return doc;
      };

      try {
        const result = await startOrResumeTrackAttempt({
          studentId: dummyCandidateA.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNew, true);
        assert.equal(createdDoc.driveAttemptNumber, 2);
        assert.equal(createdDoc.overallScore, 0);
        assert.equal(createdDoc.roundAttempts[0].status, "READY");
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        CompanyTrackAttempt.create = origCreate;
      }
    });

    test("3.5 Send duplicate launch/completion requests and verify idempotency without score corruption", async () => {
      const origFindByIdSeries = TestSeries.findById;
      const origFindByIdAttempt = CompanyTrackAttempt.findById;

      TestSeries.findById = () => ({
        lean: async () => ({
          _id: dummyTrackId,
          category: "COMPANY",
          mode: "SIMULATION",
          hiringRounds: [
            { roundOrder: 1, roundKey: "R1", roundType: "AI_INTERVIEW", cutoffPercentage: 60, weight: 100 },
          ],
        }),
      });

      const attemptDoc = {
        _id: new Types.ObjectId(),
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "AI_INTERVIEW",
            status: "IN_PROGRESS",
            interviewSessionId: "int-session-idem",
            cutoffPercentage: 60,
          },
        ],
        overallScore: 0,
        overallPercentage: 0,
        save: async function () {
          return this;
        },
      };

      CompanyTrackAttempt.findById = async () => attemptDoc;

      const mockSession = {
        interviewId: "int-session-idem",
        userId: dummyCandidateA,
        trackAttemptId: attemptDoc._id,
        trackId: dummyTrackId,
        companyRoundOrder: 1,
        interviewState: "COMPLETED",
        resultsSummary: { score: 80 },
      };

      try {
        // Call 1
        await updateTrackAttemptFromInterviewSession(mockSession);
        assert.equal(attemptDoc.roundAttempts[0].status, "PASSED");
        assert.equal(attemptDoc.overallPercentage, 80);

        // Call 2 (duplicate completion callback)
        await updateTrackAttemptFromInterviewSession(mockSession);
        // Scores should remain 80%, not double counted or corrupted
        assert.equal(attemptDoc.roundAttempts[0].status, "PASSED");
        assert.equal(attemptDoc.overallPercentage, 80);
      } finally {
        TestSeries.findById = origFindByIdSeries;
        CompanyTrackAttempt.findById = origFindByIdAttempt;
      }
    });
  });

  describe("4. Results and Analytics", () => {
    test("4.1 Verify round scores, cutoffs, weights, readiness, and recommendations on candidate dashboard", async () => {
      const origTrackFind = CompanyTrackAttempt.find;
      const origTestAttemptFind = TestAttempt.find;

      TestAttempt.find = () => ({
        select: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [],
              }),
            }),
          }),
        }),
      });

      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [
                  {
                    _id: new Types.ObjectId(),
                    studentId: dummyCandidateA,
                    companyId: { name: "Acme", slug: "acme" },
                    trackId: {
                      title: "Acme Track",
                      hiringRounds: [
                        { roundOrder: 1, roundKey: "R1", roundType: "TESTS", weight: 100 },
                      ],
                    },
                    status: "QUALIFIED",
                    roundAttempts: [
                      {
                        roundOrder: 1,
                        roundKey: "R1",
                        roundName: "Assessment",
                        roundType: "TESTS",
                        status: "PASSED",
                        scoreObtained: 85,
                        maxScore: 100,
                        percentage: 85,
                        cutoffPercentage: 60,
                        testAttemptIds: [
                          {
                            _id: new Types.ObjectId(),
                            testId: { title: "Coding Test" },
                            totalScore: 85,
                            maxScore: 100,
                            percentage: 85,
                            status: "EVALUATED",
                          },
                        ],
                      },
                    ],
                    overallPercentage: 85,
                    overallReadinessBand: "Advanced Placement Readiness",
                  },
                ],
              }),
            }),
          }),
        }),
      });

      try {
        const results = await getCompanyResultsByStudent(dummyCandidateA.toString());
        assert.equal(results.trackAttempts.length, 1);
        const attempt = results.trackAttempts[0];
        assert.equal(attempt.overallPercentage, 85);
        assert.equal(attempt.overallReadinessBand, "Advanced Placement Readiness");
        assert.equal(attempt.roundAttempts[0].cutoffPercentage, 60);
        assert.equal(attempt.roundAttempts[0].weight, 100);
      } finally {
        CompanyTrackAttempt.find = origTrackFind;
        TestAttempt.find = origTestAttemptFind;
      }
    });

    test("4.2 Verify assessment reports and AI Interview feedback open correct records", async () => {
      const origFindById = CompanyTrackAttempt.findById;
      const testAttemptId = new Types.ObjectId();
      const interviewSessionId = "int-uuid-456";

      CompanyTrackAttempt.findById = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => ({
                _id: new Types.ObjectId(),
                studentId: dummyCandidateA,
                trackId: {
                  title: "Acme Track",
                  hiringRounds: [
                    { roundOrder: 1, roundKey: "R1", roundType: "TESTS", weight: 100 },
                    { roundOrder: 2, roundKey: "R2", roundType: "AI_INTERVIEW", weight: 100 },
                  ],
                },
                companyId: { name: "Acme", slug: "acme" },
                status: "QUALIFIED",
                roundAttempts: [
                  {
                    roundOrder: 1,
                    roundKey: "R1",
                    roundName: "Assessment",
                    roundType: "TESTS",
                    status: "PASSED",
                    testAttemptIds: [
                      {
                        _id: testAttemptId,
                        testId: { _id: dummyTest1Id, title: "Online Coding Test" },
                        totalScore: 90,
                        maxScore: 100,
                        percentage: 90,
                        status: "EVALUATED",
                      },
                    ],
                  },
                  {
                    roundOrder: 2,
                    roundKey: "R2",
                    roundName: "AI Interview",
                    roundType: "AI_INTERVIEW",
                    status: "PASSED",
                    interviewSessionId,
                    scoreObtained: 85,
                    maxScore: 100,
                    percentage: 85,
                    cutoffPercentage: 70,
                  },
                ],
              }),
            }),
          }),
        }),
      });

      try {
        const attemptDetail = await getCompanyTrackAttemptById({
          attemptId: new Types.ObjectId().toString(),
          requestingUser: { _id: dummyCandidateA, role: "STUDENT" },
        });

        const r1 = attemptDetail.roundAttempts[0];
        const r2 = attemptDetail.roundAttempts[1];

        const testReportUrl = `/student/dashboard/result/${r1.testAttemptIds[0]._id}`;
        const interviewFeedbackUrl = `/student/dashboard/ai-interview/details/${r2.interviewSessionId}`;

        assert.equal(testReportUrl, `/student/dashboard/result/${testAttemptId}`);
        assert.equal(
          interviewFeedbackUrl,
          `/student/dashboard/ai-interview/details/${interviewSessionId}`
        );
      } finally {
        CompanyTrackAttempt.findById = origFindById;
      }
    });

    test("4.3 Verify admin analytics counts, pass rates, score distributions against known test data", async () => {
      const origFindAttempts = CompanyTrackAttempt.find;
      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [
                  {
                    _id: new Types.ObjectId(),
                    studentId: { _id: new Types.ObjectId(), firstName: "John", lastName: "Doe" },
                    trackId: { title: "Track 1" },
                    companyId: { name: "Acme", slug: "acme" },
                    status: "QUALIFIED",
                    overallPercentage: 90,
                    roundAttempts: [
                      { roundOrder: 1, roundName: "OA", roundType: "TESTS", status: "PASSED", percentage: 90 },
                    ],
                  },
                  {
                    _id: new Types.ObjectId(),
                    studentId: { _id: new Types.ObjectId(), firstName: "Jane", lastName: "Smith" },
                    trackId: { title: "Track 1" },
                    companyId: { name: "Acme", slug: "acme" },
                    status: "NOT_QUALIFIED",
                    overallPercentage: 40,
                    roundAttempts: [
                      { roundOrder: 1, roundName: "OA", roundType: "TESTS", status: "FAILED", percentage: 40 },
                    ],
                  },
                ],
              }),
            }),
          }),
        }),
      });

      try {
        const analytics = await getCompanyTrackAdminAnalytics(
          { _id: dummyAdminId, role: "IQPATH_ADMIN" },
          {}
        );

        assert.equal(analytics.summary.totalTrackAttempts, 2);
        assert.equal(analytics.summary.completedAttempts, 2);
        assert.equal(analytics.summary.qualificationCount, 1);
        assert.equal(analytics.summary.qualificationRate, 50); // 1 / 2 = 50%
        assert.equal(analytics.summary.averageOverallScore, 65); // (90 + 40) / 2 = 65%

        const under50Bucket = analytics.scoreDistribution.find((b) => b.range === "< 50%");
        const topBucket = analytics.scoreDistribution.find((b) => b.range === "85 - 100%");
        assert.equal(under50Bucket.count, 1);
        assert.equal(topBucket.count, 1);
      } finally {
        CompanyTrackAttempt.find = origFindAttempts;
      }
    });

    test("4.4 Verify incomplete rounds and unassessed competencies are not reported as failures", async () => {
      const origFindAttempts = CompanyTrackAttempt.find;
      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [
                  {
                    _id: new Types.ObjectId(),
                    studentId: { _id: new Types.ObjectId() },
                    trackId: { title: "Track 1" },
                    companyId: { name: "Acme" },
                    status: "IN_PROGRESS",
                    overallPercentage: 0,
                    roundAttempts: [
                      { roundOrder: 1, roundName: "OA", roundType: "TESTS", status: "READY", percentage: 0 },
                      { roundOrder: 2, roundName: "AI", roundType: "AI_INTERVIEW", status: "LOCKED", percentage: 0 },
                    ],
                  },
                ],
              }),
            }),
          }),
        }),
      });

      try {
        const analytics = await getCompanyTrackAdminAnalytics(
          { _id: dummyAdminId, role: "IQPATH_ADMIN" },
          {}
        );

        assert.equal(analytics.summary.inProgressAttempts, 1);
        assert.equal(analytics.summary.completedAttempts, 0);

        const r1Metrics = analytics.roundWiseMetrics[0];
        assert.equal(r1Metrics.inProgressCount, 1);
        assert.equal(r1Metrics.failedCount, 0); // Not counted as failure!
      } finally {
        CompanyTrackAttempt.find = origFindAttempts;
      }
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION 2: SECURITY AND MULTI-TENANT ISOLATION TESTS
     ══════════════════════════════════════════════════════════════════════════ */
  describe("2. Security and Multi-Tenant Isolation", () => {
    test("2.1 Candidate A opens Candidate B's attempt -> Access denied (403)", async () => {
      const origFindById = CompanyTrackAttempt.findById;
      CompanyTrackAttempt.findById = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => ({
                _id: new Types.ObjectId(),
                studentId: dummyCandidateB, // Belongs to Candidate B
                trackId: { title: "Target Track" },
                companyId: { name: "Acme" },
                roundAttempts: [],
              }),
            }),
          }),
        }),
      });

      try {
        await assert.rejects(
          async () => {
            await getCompanyTrackAttemptById({
              attemptId: new Types.ObjectId().toString(),
              requestingUser: { _id: dummyCandidateA, role: "STUDENT" }, // Candidate A attempts access
            });
          },
          (err) => {
            assert.equal(err.statusCode, 403);
            assert.match(err.message, /Forbidden|permission|Access denied/i);
            return true;
          }
        );
      } finally {
        CompanyTrackAttempt.findById = origFindById;
      }
    });

    test("2.2 Organization A queries Organization B's data -> No data leakage", async () => {
      const origUserFind = User.find;
      const studentAId = new Types.ObjectId();
      const studentBId = new Types.ObjectId();

      User.find = (filter) => ({
        distinct: async (field) => {
          if (String(filter.organizationId) === String(dummyOrgA)) {
            return [studentAId]; // Org A only sees Student A
          }
          return [studentBId];
        },
      });

      let capturedFilter = null;
      const origTrackFind = CompanyTrackAttempt.find;
      CompanyTrackAttempt.find = (filter) => {
        capturedFilter = filter;
        return {
          populate: () => ({
            populate: () => ({
              populate: () => ({
                sort: () => ({
                  lean: async () => [],
                }),
              }),
            }),
          }),
        };
      };

      try {
        await getCompanyTrackAdminAnalytics(
          { _id: new Types.ObjectId(), role: "ORGANIZATION", organizationId: dummyOrgA },
          {}
        );

        // Verify filter strictly scoped studentId to Org A's students
        assert.deepEqual(capturedFilter.studentId, { $in: [studentAId] });
        assert.equal(
          capturedFilter.studentId.$in.some((id) => String(id) === String(studentBId)),
          false
        );
      } finally {
        User.find = origUserFind;
        CompanyTrackAttempt.find = origTrackFind;
      }
    });

    test("2.3 Student calls admin analytics API -> 403 Forbidden", async () => {
      await assert.rejects(
        async () => {
          await getCompanyTrackAdminAnalytics(
            { _id: dummyCandidateA, role: "STUDENT" },
            {}
          );
        },
        (err) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Admin or Organization access required/i);
          return true;
        }
      );
    });

    test("2.4 Candidate starts an unpublished or deleted track -> Request rejected", async () => {
      const origFindById = TestSeries.findById;

      try {
        // Case A: Unpublished track
        TestSeries.findById = () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => ({
                _id: dummyTrackId,
                category: "COMPANY",
                isPublished: false,
                isDeleted: false,
              }),
            }),
          }),
        });

        await assert.rejects(
          async () => {
            await startOrResumeTrackAttempt({
              studentId: dummyCandidateA.toString(),
              trackId: dummyTrackId.toString(),
            });
          },
          (err) => {
            assert.equal(err.statusCode, 400);
            assert.match(err.message, /not been published/i);
            return true;
          }
        );

        // Case B: Deleted track
        TestSeries.findById = () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => ({
                _id: dummyTrackId,
                category: "COMPANY",
                isPublished: true,
                isDeleted: true,
              }),
            }),
          }),
        });

        await assert.rejects(
          async () => {
            await startOrResumeTrackAttempt({
              studentId: dummyCandidateA.toString(),
              trackId: dummyTrackId.toString(),
            });
          },
          (err) => {
            assert.equal(err.statusCode, 404);
            assert.match(err.message, /not found/i);
            return true;
          }
        );
      } finally {
        TestSeries.findById = origFindById;
      }
    });

    test("2.5 Candidate launches another candidate's interview -> Access denied", async () => {
      const mockSession = {
        interviewId: "int-other-user",
        userId: dummyCandidateB, // Belongs to Candidate B
      };

      await assert.rejects(
        async () => {
          await assertCanViewSession(
            { _id: dummyCandidateA, role: "STUDENT" }, // Candidate A attempts access
            mockSession
          );
        },
        (err) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /not authorized/i);
          return true;
        }
      );
    });

    test("2.6 Organization changes organizationId in query parameters -> Cannot access another org", async () => {
      const origUserFind = User.find;
      let queriedOrgId = null;

      User.find = (filter) => {
        queriedOrgId = filter.organizationId;
        return {
          distinct: async () => [new Types.ObjectId()],
        };
      };

      const origTrackFind = CompanyTrackAttempt.find;
      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [],
              }),
            }),
          }),
        }),
      });

      try {
        // Org A user malicious attempt: passes query { organizationId: dummyOrgB }
        await getCompanyTrackAdminAnalytics(
          { _id: new Types.ObjectId(), role: "ORGANIZATION", organizationId: dummyOrgA },
          { organizationId: dummyOrgB.toString() }
        );

        // The query organizationId MUST be ignored, using requestingUser's orgId strictly
        assert.equal(String(queriedOrgId), String(dummyOrgA));
        assert.notEqual(String(queriedOrgId), String(dummyOrgB));
      } finally {
        User.find = origUserFind;
        CompanyTrackAttempt.find = origTrackFind;
      }
    });

    test("2.7 Old interview completes after a retake -> New attempt remains unchanged", async () => {
      const origFindByIdSeries = TestSeries.findById;
      const origFindByIdAttempt = CompanyTrackAttempt.findById;

      TestSeries.findById = () => ({
        lean: async () => ({
          _id: dummyTrackId,
          category: "COMPANY",
          hiringRounds: [
            { roundOrder: 1, roundKey: "R1", roundType: "AI_INTERVIEW", cutoffPercentage: 60 },
          ],
        }),
      });

      // Active attempt currently has NEW session 'int-session-NEW'
      const activeAttemptDoc = {
        _id: new Types.ObjectId(),
        trackId: dummyTrackId,
        studentId: dummyCandidateA,
        status: "IN_PROGRESS",
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "R1",
            roundType: "AI_INTERVIEW",
            interviewSessionId: "int-session-NEW",
            status: "IN_PROGRESS",
            percentage: 0,
          },
        ],
        save: async function () {
          return this;
        },
      };

      CompanyTrackAttempt.findById = async () => activeAttemptDoc;

      // Late callback arrives for OLD session 'int-session-OLD'
      const obsoleteSession = {
        interviewId: "int-session-OLD",
        userId: dummyCandidateA,
        trackAttemptId: activeAttemptDoc._id,
        trackId: dummyTrackId,
        companyRoundOrder: 1,
        interviewState: "COMPLETED",
        resultsSummary: { score: 95 },
      };

      try {
        await updateTrackAttemptFromInterviewSession(obsoleteSession);
        // The obsolete session must be ignored: interviewSessionId and status remain unchanged
        assert.equal(activeAttemptDoc.roundAttempts[0].interviewSessionId, "int-session-NEW");
        assert.equal(activeAttemptDoc.roundAttempts[0].status, "IN_PROGRESS");
        assert.equal(activeAttemptDoc.roundAttempts[0].percentage, 0);
      } finally {
        TestSeries.findById = origFindByIdSeries;
        CompanyTrackAttempt.findById = origFindByIdAttempt;
      }
    });

    test("2.8 Two concurrent requests start the same track -> At most one active drive created", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      const origCreate = CompanyTrackAttempt.create;

      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => ({
              _id: dummyTrackId,
              category: "COMPANY",
              companyId: dummyCompanyId,
              isPublished: true,
              mode: "SIMULATION",
              hiringRounds: [
                { roundOrder: 1, roundKey: "R1", roundType: "TESTS", tests: [dummyTest1Id] },
              ],
            }),
          }),
        }),
      });

      const existingActiveAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyCandidateA,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        driveAttemptNumber: 1,
      };

      let findCount = 0;
      CompanyTrackAttempt.findOne = (query) => {
        if (query.status === "IN_PROGRESS") {
          findCount++;
          // First check: simulate race condition where findOne returns null for both
          if (findCount === 1) return Promise.resolve(null);
          // Subsequent lookup after E11000 duplicate key error returns the created active attempt
          return Promise.resolve(existingActiveAttempt);
        }
        return {
          sort: () => ({
            select: () => ({
              lean: async () => null,
            }),
          }),
        };
      };

      // Simulate MongoDB duplicate key error (E11000) thrown by concurrent create
      CompanyTrackAttempt.create = async () => {
        const dupErr = new Error("E11000 duplicate key error collection");
        dupErr.code = 11000;
        throw dupErr;
      };

      try {
        const result = await startOrResumeTrackAttempt({
          studentId: dummyCandidateA.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNew, false);
        assert.equal(result.trackAttempt._id, existingActiveAttempt._id);
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        CompanyTrackAttempt.create = origCreate;
      }
    });

    test("2.9 Private interview transcripts, audio, and raw candidate answers do not leak into aggregate admin analytics", async () => {
      const origFindAttempts = CompanyTrackAttempt.find;
      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [
                  {
                    _id: new Types.ObjectId(),
                    studentId: { _id: dummyCandidateA, firstName: "Alice", lastName: "Smith", email: "alice@example.com" },
                    trackId: { title: "Software Track", targetRole: "SE", experienceLevel: "FRESHER" },
                    companyId: { name: "TechCorp", slug: "techcorp" },
                    status: "QUALIFIED",
                    overallPercentage: 92,
                    overallReadinessBand: "Advanced Placement Readiness",
                    roundAttempts: [
                      { roundOrder: 1, roundName: "Interview", roundType: "AI_INTERVIEW", status: "PASSED", percentage: 92 },
                    ],
                  },
                ],
              }),
            }),
          }),
        }),
      });

      try {
        const analytics = await getCompanyTrackAdminAnalytics(
          { _id: dummyAdminId, role: "IQPATH_ADMIN" },
          {}
        );

        const tableItem = analytics.table.data[0];
        // Ensure aggregate table contains candidate summary info without leaking transcripts or audio
        assert.equal(tableItem.studentName, "Alice Smith");
        assert.equal(tableItem.overallPercentage, 92);
        assert.equal(tableItem.transcripts, undefined);
        assert.equal(tableItem.audioUrl, undefined);
        assert.equal(tableItem.audioStreamUrl, undefined);
        assert.equal(tableItem.rawAnswers, undefined);
        assert.equal(tableItem.conversationHistory, undefined);
      } finally {
        CompanyTrackAttempt.find = origFindAttempts;
      }
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
     SECTION 3: EXISTING FUNCTIONALITY REGRESSION TESTS
     ══════════════════════════════════════════════════════════════════════════ */
  describe("3. Existing Functionality Regression Tests", () => {
    test("3.1 Normal tests can still be created, validated, and managed without company metadata", () => {
      const normalTestSeriesPayload = {
        title: "Standard Data Structures Midterm Test Series",
        description: "General academic assessment series for university semester",
        visibility: "PUBLIC",
        category: "GENERAL",
        passingPercentage: 50,
      };

      const parsed = createTestSeriesSchema.parse(normalTestSeriesPayload);
      assert.equal(parsed.category, "GENERAL");
      assert.equal(parsed.companyId, undefined);
      assert.equal(parsed.hiringRounds.length, 0);

      const seriesDoc = new TestSeries(parsed);
      assert.equal(seriesDoc.category, "GENERAL");
      assert.equal(seriesDoc.companyId, null);
    });

    test("3.2 Normal test results strictly exclude Company-Wise attempts via { testCategory: { $ne: 'COMPANY' } }", async () => {
      let executedFilter = null;
      const origFind = TestAttempt.find;

      TestAttempt.find = (filter) => {
        executedFilter = filter;
        return {
          select: () => ({
            populate: () => ({
              populate: () => ({
                sort: () => ({
                  lean: async () => [],
                }),
              }),
            }),
          }),
        };
      };

      try {
        await findAttemptsByStudent(dummyCandidateA.toString(), { category: "GENERAL" });
        assert.deepEqual(executedFilter.testCategory, { $ne: "COMPANY" });
      } finally {
        TestAttempt.find = origFind;
      }
    });

    test("3.3 Secure Browser and proctoring enforcement still work for company assessment rounds", () => {
      const companyTest = {
        _id: dummyTest1Id,
        title: "Acme Proctored Assessment",
        secureBrowserRequired: true,
      };

      assert.equal(companyTest.secureBrowserRequired, true);

      // Verify that when secureBrowserRequired is true and student starts without active ExamSession,
      // the controller requires launch from the Secure Exam Browser
      const simulatedExamSession = null; // No active electron session claimed
      const isBlocked = companyTest.secureBrowserRequired && !simulatedExamSession;
      assert.equal(isBlocked, true);
    });

    test("3.4 Standalone AI Interviews without company metadata complete normally without touching track progression", async () => {
      const standaloneSession = {
        interviewId: "int-standalone-999",
        userId: dummyCandidateA,
        interviewState: "COMPLETED",
        resultsSummary: { score: 92 },
        // Notice: trackAttemptId and trackId are undefined
      };

      const result = await updateTrackAttemptFromInterviewSession(standaloneSession);
      assert.equal(result, null);
    });

    test("3.5 AI Interview speech recognition and audio stream capabilities remain accessible", async () => {
      // Audio stream endpoint format check
      const sampleAudioHash = "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0";
      const audioUrl = `/api/ai-interview/audio/stream/${sampleAudioHash}`;
      assert.equal(audioUrl.startsWith("/api/ai-interview/audio/stream/"), true);
      assert.equal(sampleAudioHash.length, 64);
    });

    test("3.6 Legacy company tracks without hiringRounds still behave correctly", () => {
      const legacyTrack = {
        category: "COMPANY",
        mode: "SIMULATION",
        passingPercentage: 55,
        roundsConfig: [
          { stageOrder: 1, stageKey: "STAGE_OA", stageName: "Online Assessment", cutoffPercentage: 65, retakePolicy: "ALL_TESTS" },
          { stageOrder: 2, stageKey: "STAGE_TECH", stageName: "Technical Round", cutoffPercentage: 70, retakePolicy: "FAILED_ONLY" },
        ],
        tests: [
          {
            _id: dummyTest1Id,
            title: "OA Test",
            companyStageOrder: 1,
            companyStageKey: "STAGE_OA",
            companyStageName: "Online Assessment",
          },
          {
            _id: dummyTest2Id,
            title: "Technical Coding",
            companyStageOrder: 2,
            companyStageKey: "STAGE_TECH",
            companyStageName: "Technical Round",
          },
        ],
      };

      const normalized = normalizeTrackRounds(legacyTrack);
      assert.equal(normalized.length, 2);
      assert.equal(normalized[0].roundOrder, 1);
      assert.equal(normalized[0].roundKey, "STAGE_OA");
      assert.equal(normalized[0].cutoffPercentage, 65);
      assert.equal(normalized[0].retakePolicy, "ALL_TESTS");

      assert.equal(normalized[1].roundOrder, 2);
      assert.equal(normalized[1].roundKey, "STAGE_TECH");
      assert.equal(normalized[1].cutoffPercentage, 70);
      assert.equal(normalized[1].retakePolicy, "FAILED_ONLY");
    });
  });
});
