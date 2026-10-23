import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TestSeries from "../src/models/testSeries.model.js";
import Test from "../src/models/test.model.js";
import Company from "../src/models/company.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import CompanyTrackAttempt from "../src/models/companyTrackAttempt.model.js";
import {
  normalizeTrackRounds,
  startOrResumeTrackAttempt,
  getTrackAttemptStatus,
  retakeTrackAttempt,
  updateTrackAttemptProgress,
  getCompanyTracksBySlug,
} from "../src/modules/company-exams/companyExam.service.js";
import { updateSeries } from "../src/modules/test-management/testSeries.controller.js";
import { isValidImageBuffer } from "../src/modules/company/company.controller.js";

const { Types } = mongoose;

describe("Step 4: Candidate Track Attempts and Round Progression Tests", () => {
  const dummyUserId = new Types.ObjectId();
  const dummyCompanyId = new Types.ObjectId();
  const dummyTrackId = new Types.ObjectId();
  const dummyTestId1 = new Types.ObjectId();
  const dummyTestId2 = new Types.ObjectId();
  const dummyTestId3 = new Types.ObjectId();

  /* ── 1. ROUND NORMALIZATION (MODERN VS LEGACY) ── */
  describe("Round Normalization", () => {
    test("1.1 normalizeTrackRounds correctly maps modern hiringRounds", () => {
      const modernTrack = {
        category: "COMPANY",
        mode: "SIMULATION",
        passingPercentage: 60,
        hiringRounds: [
          {
            roundOrder: 2,
            roundKey: "ROUND_TECH",
            roundName: "Technical Assessment",
            roundType: "TESTS",
            cutoffPercentage: 70,
            weight: 150,
            retakePolicy: "ALL_TESTS",
            tests: [dummyTestId2],
          },
          {
            roundOrder: 1,
            roundKey: "ROUND_OA",
            roundName: "Online Assessment",
            roundType: "TESTS",
            cutoffPercentage: 65,
            weight: 100,
            retakePolicy: "FAILED_ONLY",
            tests: [dummyTestId1],
          },
        ],
      };

      const normalized = normalizeTrackRounds(modernTrack);
      assert.equal(normalized.length, 2);
      assert.equal(normalized[0].roundOrder, 1, "Must be sorted by roundOrder ascending");
      assert.equal(normalized[0].roundKey, "ROUND_OA");
      assert.equal(normalized[0].cutoffPercentage, 65);
      assert.equal(normalized[0].retakePolicy, "FAILED_ONLY");
      assert.equal(normalized[1].roundOrder, 2);
      assert.equal(normalized[1].roundKey, "ROUND_TECH");
      assert.equal(normalized[1].weight, 150);
    });

    test("1.2 normalizeTrackRounds cleanly falls back to legacy companyStageOrder and roundsConfig", () => {
      const legacyTrack = {
        category: "COMPANY",
        mode: "SIMULATION",
        passingPercentage: 50,
        tests: [
          {
            _id: dummyTestId1,
            title: "Aptitude Test",
            companyStageOrder: 1,
            companyStageKey: "STAGE_APTITUDE",
            companyStageName: "Aptitude Round",
          },
          {
            _id: dummyTestId2,
            title: "Coding Test",
            companyStageOrder: 2,
            companyStageKey: "STAGE_CODING",
            companyStageName: "Coding Round",
          },
        ],
        roundsConfig: [
          { stageOrder: 1, stageKey: "STAGE_APTITUDE", cutoffPercentage: 55, retakePolicy: "ALL_TESTS" },
          { stageOrder: 2, stageKey: "STAGE_CODING", cutoffPercentage: 65, retakePolicy: "FAILED_ONLY" },
        ],
      };

      const normalized = normalizeTrackRounds(legacyTrack);
      assert.equal(normalized.length, 2);
      assert.equal(normalized[0].roundOrder, 1);
      assert.equal(normalized[0].roundKey, "STAGE_APTITUDE");
      assert.equal(normalized[0].cutoffPercentage, 55);
      assert.equal(normalized[1].roundOrder, 2);
      assert.equal(normalized[1].roundKey, "STAGE_CODING");
      assert.equal(normalized[1].cutoffPercentage, 65);
      assert.equal(normalized[1].retakePolicy, "FAILED_ONLY");
    });
  });

  /* ── 2. TRACK ATTEMPT CREATION & RESUMING ── */
  describe("Track Attempt Lifecycle (Create & Resume)", () => {
    test("2.1 startOrResumeTrackAttempt initializes a fresh attempt with correct status and round locks", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      const origCreate = CompanyTrackAttempt.create;

      const mockTrack = {
        _id: dummyTrackId,
        title: "Google Software Engineer Track",
        category: "COMPANY",
        companyId: dummyCompanyId,
        progressionMode: "SEQUENTIAL",
        mode: "SIMULATION",
        passingPercentage: 60,
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Online Assessment",
            roundType: "TESTS",
            cutoffPercentage: 60,
            tests: [dummyTestId1],
          },
          {
            roundOrder: 2,
            roundKey: "ROUND_2",
            roundName: "Technical Round",
            roundType: "TESTS",
            cutoffPercentage: 70,
            tests: [dummyTestId2],
          },
        ],
      };

      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => mockTrack,
          }),
        }),
      });

      let trackAttemptCreated = null;
      CompanyTrackAttempt.findOne = (query) => {
        if (query && query.status === "IN_PROGRESS") {
          return Promise.resolve(null);
        }
        return {
          sort: () => ({
            select: () => ({
              lean: async () => null, // No previous attempts
            }),
          }),
        };
      };

      CompanyTrackAttempt.create = async (payload) => {
        trackAttemptCreated = payload;
        return { ...payload, _id: new Types.ObjectId() };
      };

      try {
        const result = await startOrResumeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNew, true);
        assert.equal(trackAttemptCreated.driveAttemptNumber, 1);
        assert.equal(trackAttemptCreated.status, "IN_PROGRESS");
        assert.equal(trackAttemptCreated.currentRoundOrder, 1);
        assert.equal(trackAttemptCreated.roundAttempts.length, 2);
        assert.equal(trackAttemptCreated.roundAttempts[0].status, "READY", "First round must be READY");
        assert.equal(trackAttemptCreated.roundAttempts[1].status, "LOCKED", "Second round must be LOCKED in SEQUENTIAL mode");
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        CompanyTrackAttempt.create = origCreate;
      }
    });

    test("2.2 startOrResumeTrackAttempt in OPEN mode initializes all rounds as READY", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      const origCreate = CompanyTrackAttempt.create;

      const mockTrack = {
        _id: dummyTrackId,
        title: "Open Practice Track",
        category: "COMPANY",
        companyId: dummyCompanyId,
        progressionMode: "OPEN",
        mode: "PRACTICE",
        passingPercentage: 50,
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "Round 1", roundType: "TESTS", tests: [dummyTestId1] },
          { roundOrder: 2, roundKey: "R2", roundName: "Round 2", roundType: "TESTS", tests: [dummyTestId2] },
        ],
      };

      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => mockTrack,
          }),
        }),
      });

      let trackAttemptCreated = null;
      CompanyTrackAttempt.findOne = (query) => {
        if (query && query.status === "IN_PROGRESS") {
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

      CompanyTrackAttempt.create = async (payload) => {
        trackAttemptCreated = payload;
        return { ...payload, _id: new Types.ObjectId() };
      };

      try {
        const result = await startOrResumeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNew, true);
        assert.equal(trackAttemptCreated.roundAttempts[0].status, "READY");
        assert.equal(trackAttemptCreated.roundAttempts[1].status, "READY", "In OPEN mode, subsequent rounds must be READY");
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        CompanyTrackAttempt.create = origCreate;
      }
    });

    test("2.3 startOrResumeTrackAttempt resumes existing IN_PROGRESS attempt without duplicate creation", async () => {
      const origFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      let createCalled = false;

      const existingAttempt = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        driveAttemptNumber: 1,
        currentRoundOrder: 1,
        roundAttempts: [{ roundOrder: 1, status: "IN_PROGRESS" }],
      };

      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => ({
              _id: dummyTrackId,
              category: "COMPANY",
            }),
          }),
        }),
      });

      CompanyTrackAttempt.findOne = () => existingAttempt;
      CompanyTrackAttempt.create = async () => {
        createCalled = true;
      };

      try {
        const result = await startOrResumeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNew, false);
        assert.equal(result.trackAttempt, existingAttempt);
        assert.equal(createCalled, false, "Must not create a new attempt when active attempt exists");
      } finally {
        TestSeries.findById = origFindById;
        CompanyTrackAttempt.findOne = origFindOne;
      }
    });

    test("2.4 startOrResumeTrackAttempt rejects non-company series", async () => {
      const origFindById = TestSeries.findById;
      TestSeries.findById = () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => ({
              _id: dummyTrackId,
              category: "GENERAL",
            }),
          }),
        }),
      });

      try {
        await assert.rejects(
          async () => {
            await startOrResumeTrackAttempt({
              studentId: dummyUserId.toString(),
              trackId: dummyTrackId.toString(),
            });
          },
          /not a company placement track/
        );
      } finally {
        TestSeries.findById = origFindById;
      }
    });
  });

  /* ── 3. ROUND PROGRESSION & CUTOFF EVALUATION ── */
  describe("Round Progression & Cutoff Evaluation", () => {
    test("3.1 updateTrackAttemptProgress unlocks next round when cutoff percentage is met", async () => {
      const origTestAttemptFindById = TestAttempt.findById;
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;
      const origTestAttemptFind = TestAttempt.find;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId = new Types.ObjectId();

      const mockTestAttempt = {
        _id: mockTestAttemptId,
        testId: dummyTestId1,
        studentId: dummyUserId,
        testCategory: "COMPANY",
        companyTrackAttemptId: mockTrackAttemptId,
        companyTrackId: dummyTrackId,
        companyRoundOrder: 1,
        totalScore: 80,
        maxScore: 100,
        status: "EVALUATED",
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        progressionMode: "SEQUENTIAL",
        passingPercentage: 60,
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Online Assessment",
            cutoffPercentage: 60,
            tests: [dummyTestId1],
          },
          {
            roundOrder: 2,
            roundKey: "ROUND_2",
            roundName: "Technical Round",
            cutoffPercentage: 70,
            tests: [dummyTestId2],
          },
        ],
      };

      let savedTrackAttempt = null;
      const mockTrackAttempt = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyUserId,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Online Assessment",
            status: "IN_PROGRESS",
            cutoffPercentage: 60,
            testAttemptIds: [mockTestAttemptId],
          },
          {
            roundOrder: 2,
            roundKey: "ROUND_2",
            roundName: "Technical Round",
            status: "LOCKED",
            cutoffPercentage: 70,
            testAttemptIds: [],
          },
        ],
        save: async function () {
          savedTrackAttempt = this;
          return this;
        },
      };

      TestAttempt.findById = async () => mockTestAttempt;
      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      TestAttempt.find = () => ({
        lean: async () => [mockTestAttempt],
      });

      try {
        await updateTrackAttemptProgress(mockTestAttempt);

        assert.ok(savedTrackAttempt, "Track attempt should be saved");
        assert.equal(savedTrackAttempt.roundAttempts[0].status, "PASSED");
        assert.equal(savedTrackAttempt.roundAttempts[0].percentage, 80);
        assert.equal(savedTrackAttempt.roundAttempts[1].status, "READY", "Round 2 must be unlocked to READY");
        assert.equal(savedTrackAttempt.currentRoundOrder, 2, "Current round must advance to 2");
      } finally {
        TestAttempt.findById = origTestAttemptFindById;
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
        TestAttempt.find = origTestAttemptFind;
      }
    });

    test("3.2 updateTrackAttemptProgress marks round FAILED and track NOT_QUALIFIED in SIMULATION mode on cutoff failure", async () => {
      const origTestAttemptFindById = TestAttempt.findById;
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;
      const origTestAttemptFind = TestAttempt.find;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId = new Types.ObjectId();

      const mockTestAttempt = {
        _id: mockTestAttemptId,
        testId: dummyTestId1,
        studentId: dummyUserId,
        testCategory: "COMPANY",
        companyTrackAttemptId: mockTrackAttemptId,
        companyTrackId: dummyTrackId,
        companyRoundOrder: 1,
        totalScore: 40,
        maxScore: 100, // 40% vs 60% cutoff
        status: "EVALUATED",
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        passingPercentage: 60,
        hiringRounds: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Online Assessment",
            cutoffPercentage: 60,
            tests: [dummyTestId1],
          },
        ],
      };

      let savedTrackAttempt = null;
      const mockTrackAttempt = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyUserId,
        status: "IN_PROGRESS",
        currentRoundOrder: 1,
        roundAttempts: [
          {
            roundOrder: 1,
            roundKey: "ROUND_1",
            roundName: "Online Assessment",
            status: "IN_PROGRESS",
            cutoffPercentage: 60,
            testAttemptIds: [mockTestAttemptId],
          },
        ],
        save: async function () {
          savedTrackAttempt = this;
          return this;
        },
      };

      TestAttempt.findById = async () => mockTestAttempt;
      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      TestAttempt.find = () => ({
        lean: async () => [mockTestAttempt],
      });

      try {
        await updateTrackAttemptProgress(mockTestAttempt);

        assert.equal(savedTrackAttempt.roundAttempts[0].status, "FAILED");
        assert.equal(savedTrackAttempt.status, "NOT_QUALIFIED", "In SIMULATION mode, failing a round concludes the drive as NOT_QUALIFIED");
        assert.ok(savedTrackAttempt.completedAt, "completedAt must be populated");
      } finally {
        TestAttempt.findById = origTestAttemptFindById;
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
        TestAttempt.find = origTestAttemptFind;
      }
    });

    test("3.3 updateTrackAttemptProgress marks track QUALIFIED when final round passes", async () => {
      const origTestAttemptFindById = TestAttempt.findById;
      const origTrackAttemptFindById = CompanyTrackAttempt.findById;
      const origTrackFindById = TestSeries.findById;
      const origTestAttemptFind = TestAttempt.find;

      const mockTrackAttemptId = new Types.ObjectId();
      const mockTestAttemptId = new Types.ObjectId();

      const mockTestAttempt = {
        _id: mockTestAttemptId,
        testId: dummyTestId2,
        studentId: dummyUserId,
        testCategory: "COMPANY",
        companyTrackAttemptId: mockTrackAttemptId,
        companyTrackId: dummyTrackId,
        companyRoundOrder: 2,
        totalScore: 90,
        maxScore: 100,
        status: "EVALUATED",
      };

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        mode: "SIMULATION",
        passingPercentage: 60,
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", cutoffPercentage: 60, tests: [dummyTestId1] },
          { roundOrder: 2, roundKey: "R2", cutoffPercentage: 70, tests: [dummyTestId2] },
        ],
      };

      let savedTrackAttempt = null;
      const mockTrackAttempt = {
        _id: mockTrackAttemptId,
        trackId: dummyTrackId,
        studentId: dummyUserId,
        status: "IN_PROGRESS",
        currentRoundOrder: 2,
        roundAttempts: [
          { roundOrder: 1, roundKey: "R1", status: "PASSED", scoreObtained: 85, maxScore: 100, cutoffPercentage: 60 },
          { roundOrder: 2, roundKey: "R2", status: "IN_PROGRESS", cutoffPercentage: 70, testAttemptIds: [mockTestAttemptId] },
        ],
        save: async function () {
          savedTrackAttempt = this;
          return this;
        },
      };

      TestAttempt.findById = async () => mockTestAttempt;
      CompanyTrackAttempt.findById = async () => mockTrackAttempt;
      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      TestAttempt.find = () => ({
        lean: async () => [mockTestAttempt],
      });

      try {
        await updateTrackAttemptProgress(mockTestAttempt);

        assert.equal(savedTrackAttempt.roundAttempts[1].status, "PASSED");
        assert.equal(savedTrackAttempt.status, "QUALIFIED", "Track should be marked QUALIFIED when all rounds are passed");
        assert.ok(savedTrackAttempt.completedAt);
        assert.equal(savedTrackAttempt.overallPercentage, 88); // (85 + 90) / 200 = 87.5% -> 88%
        assert.equal(savedTrackAttempt.overallReadinessBand, "Advanced Placement Readiness");
      } finally {
        TestAttempt.findById = origTestAttemptFindById;
        CompanyTrackAttempt.findById = origTrackAttemptFindById;
        TestSeries.findById = origTrackFindById;
        TestAttempt.find = origTestAttemptFind;
      }
    });
  });

  /* ── 4. RETAKE DRIVES & ISOLATION ── */
  describe("Retake Policies & Scope Isolation", () => {
    test("4.1 retakeTrackAttempt increments driveAttemptNumber and resets all rounds", async () => {
      const origTrackFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;
      const origCreate = CompanyTrackAttempt.create;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        companyId: dummyCompanyId,
        mode: "SIMULATION",
        progressionMode: "SEQUENTIAL",
        hiringRounds: [
          { roundOrder: 1, roundKey: "R1", roundName: "OA", roundType: "TESTS", cutoffPercentage: 60, tests: [dummyTestId1] },
          { roundOrder: 2, roundKey: "R2", roundName: "Tech", roundType: "TESTS", cutoffPercentage: 70, tests: [dummyTestId2] },
        ],
      };

      const existingFailedDrive = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "NOT_QUALIFIED",
        driveAttemptNumber: 1,
      };

      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      CompanyTrackAttempt.findOne = () => ({
        sort: async () => existingFailedDrive,
      });

      let newDriveCreated = null;
      CompanyTrackAttempt.create = async (payload) => {
        newDriveCreated = payload;
        return { ...payload, _id: new Types.ObjectId() };
      };

      try {
        const result = await retakeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
        });

        assert.equal(result.isNewDrive, true);
        assert.equal(newDriveCreated.driveAttemptNumber, 2, "Drive attempt number must increment to 2");
        assert.equal(newDriveCreated.status, "IN_PROGRESS");
        assert.equal(newDriveCreated.roundAttempts[0].status, "READY");
        assert.equal(newDriveCreated.roundAttempts[1].status, "LOCKED");
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origFindOne;
        CompanyTrackAttempt.create = origCreate;
      }
    });

    test("4.2 retakeTrackAttempt in PRACTICE mode resets specific round without creating new drive", async () => {
      const origTrackFindById = TestSeries.findById;
      const origFindOne = CompanyTrackAttempt.findOne;

      const mockTrack = {
        _id: dummyTrackId,
        category: "COMPANY",
        companyId: dummyCompanyId,
        mode: "PRACTICE", // Practice mode allows modular round retake
        progressionMode: "SEQUENTIAL",
      };

      let saveInvoked = false;
      const activeDrive = {
        _id: new Types.ObjectId(),
        studentId: dummyUserId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        driveAttemptNumber: 1,
        roundAttempts: [
          { roundOrder: 1, status: "FAILED", scoreObtained: 40, percentage: 40 },
          { roundOrder: 2, status: "LOCKED" },
        ],
        save: async () => {
          saveInvoked = true;
        },
      };

      TestSeries.findById = () => ({
        lean: async () => mockTrack,
      });
      CompanyTrackAttempt.findOne = () => ({
        sort: async () => activeDrive,
      });

      try {
        const result = await retakeTrackAttempt({
          studentId: dummyUserId.toString(),
          trackId: dummyTrackId.toString(),
          roundOrder: 1,
        });

        assert.equal(result.isNewDrive, false);
        assert.equal(activeDrive.roundAttempts[0].status, "READY", "Target round must be reset to READY");
        assert.equal(activeDrive.roundAttempts[0].scoreObtained, 0);
        assert.equal(saveInvoked, true);
      } finally {
        TestSeries.findById = origTrackFindById;
        CompanyTrackAttempt.findOne = origFindOne;
      }
    });
  });

  /* ── 5. CARRY-FORWARD CHECKS FROM STEP 3 ── */
  describe("Carry-Forward Step 3 Verification Gates", () => {
    test("5.1 ORGANIZATION user cannot modify COMPANY series (403 Forbidden)", async () => {
      let statusCalled = null;
      let jsonCalled = null;
      const res = {
        status: (code) => {
          statusCalled = code;
          return res;
        },
        json: (payload) => {
          jsonCalled = payload;
          return res;
        },
      };

      const req = {
        params: { id: dummyTrackId.toString() },
        user: { _id: dummyUserId, role: "ORGANIZATION" },
        series: {
          _id: dummyTrackId,
          category: "COMPANY", // Company track cannot be edited by org
          createdBy: { userId: dummyUserId, role: "IQPATH_ADMIN" },
        },
        body: { title: "Hacked Company Track" },
      };

      await updateSeries(req, res);
      assert.equal(statusCalled, 403);
      assert.equal(jsonCalled.success, false);
      assert.match(jsonCalled.message, /Organization users are not permitted/);
    });

    test("5.2 ORGANIZATION user cannot modify another organization's series (403 Forbidden)", async () => {
      let statusCalled = null;
      let jsonCalled = null;
      const res = {
        status: (code) => {
          statusCalled = code;
          return res;
        },
        json: (payload) => {
          jsonCalled = payload;
          return res;
        },
      };

      const otherOrgUserId = new Types.ObjectId();
      const req = {
        params: { id: dummyTrackId.toString() },
        user: { _id: dummyUserId, role: "ORGANIZATION" },
        series: {
          _id: dummyTrackId,
          category: "GENERAL",
          createdBy: { userId: otherOrgUserId, role: "ORGANIZATION" }, // Belongs to different org
        },
        body: { title: "Tampered Series" },
      };

      await updateSeries(req, res);
      assert.equal(statusCalled, 403);
      assert.equal(jsonCalled.success, false);
      assert.match(jsonCalled.message, /You can only update test series created by your organization/);
    });

    test("5.3 isValidImageBuffer correctly validates real magic bytes and rejects spoofed files", () => {
      // JPEG magic bytes: FF D8 FF
      const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      assert.equal(isValidImageBuffer(validJpeg), true);

      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      assert.equal(isValidImageBuffer(validPng), true);

      // GIF magic bytes: 47 49 46 38
      const validGif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
      assert.equal(isValidImageBuffer(validGif), true);

      // WEBP magic bytes: RIFF....WEBP
      const validWebp = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      assert.equal(isValidImageBuffer(validWebp), true);

      // Spoofed file (bash script / executable disguised as image)
      const spoofedFile = Buffer.from("#!/bin/bash\necho 'hacked'\nexit 0;");
      assert.equal(isValidImageBuffer(spoofedFile), false, "Must reject spoofed file without valid magic bytes");

      // Short buffer
      const shortBuffer = Buffer.from([0x01, 0x02]);
      assert.equal(isValidImageBuffer(shortBuffer), false);
    });
  });
});
