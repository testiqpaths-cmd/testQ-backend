import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TestSeries from "../src/models/testSeries.model.js";
import CompanyTrackAttempt from "../src/models/companyTrackAttempt.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import User from "../src/models/user.model.js";
import InterviewSession from "../src/ai-interview/schemas/interview-session.schema.js";
import {
  getCompanyResultsByStudent,
  getCompanyTrackAttemptById,
  getCompanyTrackAdminAnalytics,
  summarizeTestPerformance,
  deriveScoringExplanation,
  buildUnifiedRecommendations,
  updateTrackAttemptFromInterviewSession,
  updateTrackAttemptProgress,
} from "../src/modules/company-exams/companyExam.service.js";

const { Types } = mongoose;

describe("Step 6: Unified Analytics and Reporting Test Suite", () => {
  const studentAId = new Types.ObjectId();
  const studentBId = new Types.ObjectId();
  const org1Id = new Types.ObjectId();
  const org2Id = new Types.ObjectId();
  const dummyCompanyId = new Types.ObjectId();
  const dummyTrackId = new Types.ObjectId();

  /* ── 1. CANDIDATE OWNERSHIP & UNAUTHORIZED ACCESS ── */
  describe("1. Candidate Ownership & Unauthorized Access Controls", () => {
    test("1.1 getCompanyResultsByStudent scopes query strictly to the requesting candidate ID", async () => {
      const origFind = CompanyTrackAttempt.find;
      const origTestFind = TestAttempt.find;

      let capturedTrackQuery = null;
      let capturedTestQuery = null;

      CompanyTrackAttempt.find = (q) => {
        capturedTrackQuery = q;
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

      TestAttempt.find = (q) => {
        capturedTestQuery = q;
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
        const res = await getCompanyResultsByStudent(studentAId);
        assert.ok(res.trackAttempts);
        assert.ok(res.testAttempts);
        assert.equal(String(capturedTrackQuery.studentId), String(studentAId));
        assert.equal(String(capturedTestQuery.studentId), String(studentAId));
      } finally {
        CompanyTrackAttempt.find = origFind;
        TestAttempt.find = origTestFind;
      }
    });

    test("1.2 getCompanyTrackAttemptById throws 403 when candidate attempts to access another candidate's drive", async () => {
      const origFindById = CompanyTrackAttempt.findById;
      const attemptDocId = new Types.ObjectId();

      CompanyTrackAttempt.findById = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => ({
                _id: attemptDocId,
                studentId: studentBId, // Belongs to Student B
                status: "QUALIFIED",
              }),
            }),
          }),
        }),
      });

      try {
        await assert.rejects(
          async () => {
            await getCompanyTrackAttemptById({
              attemptId: attemptDocId,
              requestingUser: { _id: studentAId, role: "STUDENT" }, // Student A requesting
            });
          },
          (err) => {
            assert.equal(err.statusCode, 403);
            assert.match(err.message, /Forbidden/i);
            return true;
          }
        );
      } finally {
        CompanyTrackAttempt.findById = origFindById;
      }
    });

    test("1.3 getCompanyTrackAttemptById permits candidate viewing their own attempt or admin viewing any attempt", async () => {
      const origFindById = CompanyTrackAttempt.findById;
      const attemptDocId = new Types.ObjectId();
      const mockDoc = {
        _id: attemptDocId,
        studentId: studentAId,
        status: "QUALIFIED",
        overallPercentage: 88,
      };

      CompanyTrackAttempt.findById = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => mockDoc,
            }),
          }),
        }),
      });

      try {
        // Candidate owner access
        const candidateRes = await getCompanyTrackAttemptById({
          attemptId: attemptDocId,
          requestingUser: { _id: studentAId, role: "STUDENT" },
        });
        assert.equal(String(candidateRes._id), String(attemptDocId));

        // IQPATH_ADMIN access
        const adminRes = await getCompanyTrackAttemptById({
          attemptId: attemptDocId,
          requestingUser: { _id: new Types.ObjectId(), role: "IQPATH_ADMIN" },
        });
        assert.equal(String(adminRes._id), String(attemptDocId));
      } finally {
        CompanyTrackAttempt.findById = origFindById;
      }
    });
  });

  /* ── 2. HISTORICAL DRIVE ISOLATION & RETAKE INTEGRITY ── */
  describe("2. Historical Drive Isolation & Retake Safeguards", () => {
    test("2.1 Multiple drive attempts for same track remain isolated and unmerged", async () => {
      const origFind = CompanyTrackAttempt.find;
      const origTestFind = TestAttempt.find;

      const drive1 = {
        _id: new Types.ObjectId(),
        studentId: studentAId,
        trackId: dummyTrackId,
        companyId: dummyCompanyId,
        driveAttemptNumber: 1,
        status: "NOT_QUALIFIED",
        overallScore: 40,
        overallPercentage: 40,
        overallReadinessBand: "Needs More Practice",
        roundAttempts: [
          {
            roundOrder: 1,
            roundName: "Assessment",
            roundType: "TESTS",
            status: "FAILED",
            percentage: 40,
            cutoffPercentage: 60,
          },
        ],
        createdAt: new Date("2026-03-01"),
      };

      const drive2 = {
        _id: new Types.ObjectId(),
        studentId: studentAId,
        trackId: dummyTrackId,
        companyId: dummyCompanyId,
        driveAttemptNumber: 2,
        status: "QUALIFIED",
        overallScore: 85,
        overallPercentage: 85,
        overallReadinessBand: "Advanced Placement Readiness",
        roundAttempts: [
          {
            roundOrder: 1,
            roundName: "Assessment",
            roundType: "TESTS",
            status: "PASSED",
            percentage: 85,
            cutoffPercentage: 60,
          },
        ],
        createdAt: new Date("2026-03-05"),
      };

      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [drive2, drive1],
              }),
            }),
          }),
        }),
      });

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

      try {
        const res = await getCompanyResultsByStudent(studentAId);
        assert.equal(res.trackAttempts.length, 2);

        const d2 = res.trackAttempts.find((d) => d.driveAttemptNumber === 2);
        const d1 = res.trackAttempts.find((d) => d.driveAttemptNumber === 1);

        assert.equal(d2.status, "QUALIFIED");
        assert.equal(d2.overallPercentage, 85);
        assert.equal(d2.isQualified, true);

        assert.equal(d1.status, "NOT_QUALIFIED");
        assert.equal(d1.overallPercentage, 40);
        assert.equal(d1.isFailed, true);
      } finally {
        CompanyTrackAttempt.find = origFind;
        TestAttempt.find = origTestFind;
      }
    });

    test("2.2 updateTrackAttemptFromInterviewSession ignores evaluations for closed drives", async () => {
      const origFindById = CompanyTrackAttempt.findById;
      const closedAttempt = {
        _id: new Types.ObjectId(),
        studentId: studentAId,
        status: "NOT_QUALIFIED", // Closed
        roundAttempts: [{ roundOrder: 2, roundType: "AI_INTERVIEW", status: "FAILED" }],
      };

      CompanyTrackAttempt.findById = async () => closedAttempt;

      try {
        const res = await updateTrackAttemptFromInterviewSession({
          interviewId: "session-delayed-001",
          userId: studentAId,
          trackAttemptId: closedAttempt._id,
          interviewState: "COMPLETED",
          resultsSummary: { score: 95 },
        });

        // Returned as-is without mutating status or advancing
        assert.equal(res.status, "NOT_QUALIFIED");
      } finally {
        CompanyTrackAttempt.findById = origFindById;
      }
    });

    test("2.3 updateTrackAttemptFromInterviewSession ignores obsolete session when round has a newer session", async () => {
      const origFindById = CompanyTrackAttempt.findById;
      const origSeriesFindById = TestSeries.findById;
      const activeAttempt = {
        _id: new Types.ObjectId(),
        studentId: studentAId,
        trackId: dummyTrackId,
        status: "IN_PROGRESS",
        roundAttempts: [
          {
            roundOrder: 2,
            roundType: "AI_INTERVIEW",
            status: "IN_PROGRESS",
            interviewSessionId: "session-new-round2", // newer active session
          },
        ],
      };

      CompanyTrackAttempt.findById = async () => activeAttempt;
      TestSeries.findById = () => ({
        lean: async () => ({
          _id: dummyTrackId,
          category: "COMPANY",
          hiringRounds: [
            { roundOrder: 2, roundType: "AI_INTERVIEW", cutoffPercentage: 60, weight: 100 },
          ],
        }),
      });

      try {
        // Late arrival of old session
        const res = await updateTrackAttemptFromInterviewSession({
          interviewId: "session-old-superseded",
          userId: studentAId,
          trackAttemptId: activeAttempt._id,
          companyRoundOrder: 2,
          interviewState: "COMPLETED",
          resultsSummary: { score: 100 },
        });

        // Did not overwrite roundAttempt.interviewSessionId
        assert.equal(res.roundAttempts[0].interviewSessionId, "session-new-round2");
        assert.equal(res.roundAttempts[0].status, "IN_PROGRESS");
      } finally {
        CompanyTrackAttempt.findById = origFindById;
        TestSeries.findById = origSeriesFindById;
      }
    });
  });

  /* ── 3. TEST & INTERVIEW PERFORMANCE ANALYSIS REUSE ── */
  describe("3. Round-Wise Performance Summaries & Data Reuse", () => {
    test("3.1 summarizeTestPerformance calculates scores, question accuracy, and topic breakdown from real snapshots", () => {
      const mockTestAttempts = [
        {
          totalScore: 18,
          maxScore: 20,
          percentage: 90,
          totalQuestions: 2,
          questionSnapshots: [
            { questionId: new Types.ObjectId(), topicName: "Data Structures", marks: 10 },
            { questionId: new Types.ObjectId(), topicName: "Algorithms", marks: 10 },
          ],
          answers: [
            { isCorrect: true, marksObtained: 10 },
            { isCorrect: false, selectedOption: "B", marksObtained: 0 },
          ],
        },
      ];

      const summary = summarizeTestPerformance(mockTestAttempts);
      assert.equal(summary.totalScore, 18);
      assert.equal(summary.maxScore, 20);
      assert.equal(summary.percentage, 90);
      assert.equal(summary.correctAnswers, 1);
      assert.equal(summary.incorrectAnswers, 1);
      assert.equal(summary.topicDataAvailable, true);
      assert.equal(summary.topicBreakdown.length, 2);
    });

    test("3.2 summarizeTestPerformance handles legacy attempts without question snapshots safely", () => {
      const mockLegacyAttempts = [
        {
          totalScore: 45,
          maxScore: 50,
          percentage: 90,
          totalQuestions: 25,
          testId: { title: "Cognitive Aptitude Test" },
          answers: [{ isCorrect: true }, { isCorrect: true }],
        },
      ];

      const summary = summarizeTestPerformance(mockLegacyAttempts);
      assert.equal(summary.totalScore, 45);
      assert.equal(summary.maxScore, 50);
      assert.equal(summary.correctAnswers, 2);
      assert.equal(summary.topicDataAvailable, true);
      assert.equal(summary.topicBreakdown[0].topic, "Cognitive Aptitude Test");
    });

    test("3.3 buildUnifiedRecommendations attributes source round and avoids duplicate suggestions", () => {
      const testPerformance = {
        weakTopics: ["Dynamic Programming", "Recursion"],
      };

      const interviewEvaluation = {
        weaknesses: ["Recursion", "System Architecture"],
        recommendedPractice: ["System Architecture", "Concurrency"],
      };

      const recs = buildUnifiedRecommendations({
        testPerformance,
        interviewEvaluation,
        roundName: "Technical Round",
      });

      // Assert sources
      const assessmentRec = recs.find((r) => r.category === "ASSESSMENT");
      const interviewRec = recs.find((r) => r.category === "INTERVIEW");
      assert.ok(assessmentRec);
      assert.ok(interviewRec);
      assert.equal(assessmentRec.type, "EVIDENCE_BASED");
      assert.equal(interviewRec.type, "AI_EVALUATION");

      // Assert deduplication
      const titles = recs.map((r) => r.title.toLowerCase());
      const uniqueTitles = new Set(titles);
      assert.equal(titles.length, uniqueTitles.size);
    });
  });

  /* ── 4. DERIVED SCORING & READINESS BAND CONSISTENCY ── */
  describe("4. Derived Scoring & Readiness Band Consistency", () => {
    test("4.1 deriveScoringExplanation accurately reflects round weights and contribution percentages", () => {
      const mockTrack = {
        hiringRounds: [
          { roundOrder: 1, roundName: "Online Assessment", roundType: "TESTS", weight: 60, cutoffPercentage: 50 },
          { roundOrder: 2, roundName: "AI Interview", roundType: "AI_INTERVIEW", weight: 40, cutoffPercentage: 60 },
        ],
      };

      const mockAttempt = {
        overallPercentage: 80,
        overallReadinessBand: "Strong Placement Readiness",
        roundAttempts: [
          { roundOrder: 1, status: "PASSED", percentage: 80, scoreObtained: 48, maxScore: 60 },
          { roundOrder: 2, status: "PASSED", percentage: 80, scoreObtained: 80, maxScore: 100 },
        ],
      };

      const explanation = deriveScoringExplanation(mockTrack, mockAttempt);
      assert.equal(explanation.totalWeight, 100);
      assert.equal(explanation.roundContributions[0].effectiveWeightPercentage, 60);
      assert.equal(explanation.roundContributions[1].effectiveWeightPercentage, 40);
      assert.equal(explanation.overallReadinessBand, "Strong Placement Readiness");
      assert.ok(explanation.formula.includes("Sum(Round Percentage * Round Weight)"));
    });

    test("4.2 Distinction between IN_PROGRESS and NOT_QUALIFIED is preserved", async () => {
      const origFind = CompanyTrackAttempt.find;
      const origTestFind = TestAttempt.find;

      const inProgressDrive = {
        _id: new Types.ObjectId(),
        studentId: studentAId,
        driveAttemptNumber: 1,
        status: "IN_PROGRESS",
        overallPercentage: 75,
        overallReadinessBand: "Strong Placement Readiness",
        roundAttempts: [{ roundOrder: 1, status: "PASSED", percentage: 75 }],
      };

      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => [inProgressDrive],
              }),
            }),
          }),
        }),
      });

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

      try {
        const res = await getCompanyResultsByStudent(studentAId);
        const drive = res.trackAttempts[0];
        assert.equal(drive.status, "IN_PROGRESS");
        assert.equal(drive.isIncomplete, true);
        assert.equal(drive.isFailed, false);
        assert.equal(drive.isQualified, false);
      } finally {
        CompanyTrackAttempt.find = origFind;
        TestAttempt.find = origTestFind;
      }
    });
  });

  /* ── 5. ADMIN ANALYTICS & MULTI-TENANCY AUTHORIZATION ── */
  describe("5. Admin Analytics & Multi-Tenancy Scoping", () => {
    test("5.1 getCompanyTrackAdminAnalytics rejects non-admin users with 403 Forbidden", async () => {
      await assert.rejects(
        async () => {
          await getCompanyTrackAdminAnalytics({ _id: studentAId, role: "STUDENT" });
        },
        (err) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Forbidden/i);
          return true;
        }
      );
    });

    test("5.2 getCompanyTrackAdminAnalytics scopes ORGANIZATION queries strictly to org students", async () => {
      const origUserFind = User.find;
      const origAttemptFind = CompanyTrackAttempt.find;

      const orgStudentIds = [studentAId];
      User.find = (q) => {
        assert.equal(String(q.organizationId), String(org1Id));
        return {
          distinct: async () => orgStudentIds,
        };
      };

      let capturedMatch = null;
      CompanyTrackAttempt.find = (match) => {
        capturedMatch = match;
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
        const res = await getCompanyTrackAdminAnalytics({
          _id: new Types.ObjectId(),
          role: "ORGANIZATION",
          organizationId: org1Id,
        });

        assert.ok(capturedMatch.studentId);
        assert.deepEqual(capturedMatch.studentId.$in, orgStudentIds);
        assert.ok(res.summary);
      } finally {
        User.find = origUserFind;
        CompanyTrackAttempt.find = origAttemptFind;
      }
    });

    test("5.3 getCompanyTrackAdminAnalytics aggregates participation, rates, distributions, and round metrics", async () => {
      const origAttemptFind = CompanyTrackAttempt.find;

      const mockAttempts = [
        {
          _id: new Types.ObjectId(),
          studentId: { _id: studentAId, firstName: "Alice", lastName: "Smith", email: "alice@test.com" },
          trackId: { title: "SDE Track", targetRole: "SDE 1", experienceLevel: "1-3 Years" },
          companyId: { name: "Acme Corp", slug: "acme" },
          status: "QUALIFIED",
          overallPercentage: 90,
          overallReadinessBand: "Advanced Placement Readiness",
          roundAttempts: [
            { roundOrder: 1, roundName: "Assessment", roundType: "TESTS", status: "PASSED", percentage: 90 },
            { roundOrder: 2, roundName: "AI Interview", roundType: "AI_INTERVIEW", status: "PASSED", percentage: 90 },
          ],
        },
        {
          _id: new Types.ObjectId(),
          studentId: { _id: studentBId, firstName: "Bob", lastName: "Jones", email: "bob@test.com" },
          trackId: { title: "SDE Track", targetRole: "SDE 1", experienceLevel: "1-3 Years" },
          companyId: { name: "Acme Corp", slug: "acme" },
          status: "NOT_QUALIFIED",
          overallPercentage: 45,
          overallReadinessBand: "Needs More Practice",
          roundAttempts: [
            { roundOrder: 1, roundName: "Assessment", roundType: "TESTS", status: "FAILED", percentage: 45 },
          ],
        },
      ];

      CompanyTrackAttempt.find = () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                lean: async () => mockAttempts,
              }),
            }),
          }),
        }),
      });

      try {
        const res = await getCompanyTrackAdminAnalytics({
          _id: new Types.ObjectId(),
          role: "IQPATH_ADMIN",
        });

        assert.equal(res.summary.totalCandidatesStarted, 2);
        assert.equal(res.summary.totalTrackAttempts, 2);
        assert.equal(res.summary.completedAttempts, 2);
        assert.equal(res.summary.qualificationCount, 1);
        assert.equal(res.summary.qualificationRate, 50); // 1 / 2 = 50%
        assert.equal(res.summary.completionRate, 100);

        // Score distributions
        const under50 = res.scoreDistribution.find((b) => b.range === "< 50%");
        const range85plus = res.scoreDistribution.find((b) => b.range === "85 - 100%");
        assert.equal(under50.count, 1);
        assert.equal(range85plus.count, 1);

        // Round metrics
        assert.equal(res.roundWiseMetrics.length, 2);
        const r1 = res.roundWiseMetrics.find((r) => r.roundOrder === 1);
        assert.equal(r1.totalAttempts, 2);
        assert.equal(r1.passedCount, 1);
        assert.equal(r1.failedCount, 1);
        assert.equal(r1.passRate, 50);

        // Table
        assert.equal(res.table.data.length, 2);
        assert.equal(res.table.data[0].studentName, "Alice Smith");
      } finally {
        CompanyTrackAttempt.find = origAttemptFind;
      }
    });
  });
});
