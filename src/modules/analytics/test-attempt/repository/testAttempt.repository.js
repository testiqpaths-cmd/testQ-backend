import TestAttempt from "../../../../models/testAttempt.model.js";
import TestAssignment from "../../../../models/testAssignment.model.js";
import mongoose from "mongoose";

export const findAttemptsByStudent = async (studentId, { includeIQRoom = false, category = "GENERAL" } = {}) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      throw new Error("Invalid student id");
    }

    // IQ Room attempts are excluded by default — they belong only on the IQ
    // Room History page (its own Result/Leaderboard tabs), not mixed in with
    // regular test results. Callers that DO want them alongside regular
    // results (the admin/org "Tests and Performance" report, which has its
    // own IQ Room tab) opt in via includeIQRoom.
    const iqRoomFilter = includeIQRoom ? {} : { $or: [{ iqRoomId: null }, { iqRoomId: { $exists: false } }] };

    let categoryFilter = {};
    if (category === "GENERAL") {
      categoryFilter = { testCategory: { $ne: "COMPANY" } };
    } else if (category === "COMPANY") {
      categoryFilter = { testCategory: "COMPANY" };
    }

    const attempts = await TestAttempt.find({
      studentId: new mongoose.Types.ObjectId(studentId),
      status: { $in: ["SUBMITTED", "EVALUATED", "MISSED"] },
      ...iqRoomFilter,
      ...categoryFilter,
    })
      .select(
        "testId iqRoomId testCategory companyId totalScore maxScore percentage resultStatus status submittedAt evaluatedAt totalQuestions duration"
      )
      .populate({
        path: 'testId',
        select: 'title duration totalQuestions testSeriesId totalMarks createdBy isIQRoomTest companyId companyStage',
        populate: [
          { path: 'testSeriesId', select: 'title category companyId' },
          { path: 'companyId', select: 'name slug logoUrl' },
        ],
      })
      .populate({
        path: 'companyId',
        select: 'name slug logoUrl',
      })
      .sort({ submittedAt: -1 })
      .lean();

    // Gate on the student having actually accepted the test — otherwise a
    // result can keep showing forever even after the assignment was reset
    // to PENDING/DECLINED, since nothing else re-checks acceptance once an
    // attempt document already exists.
    const testIds = attempts
      .map((a) => a.testId?._id || a.testId)
      .filter(Boolean);

    const assignments = testIds.length
      ? await TestAssignment.find({
          studentId: new mongoose.Types.ObjectId(studentId),
          testId: { $in: testIds },
        })
          .select("testId acceptedAt status")
          .lean()
      : [];

    const assignmentMap = new Map(
      assignments.map((assignment) => [String(assignment.testId), assignment])
    );

    const acceptedAttempts = attempts.filter((a) => {
      // IQ Room tests are joined directly via room code, not through the
      // normal assign/accept flow — they never get a TestAssignment record,
      // so gating on one here would silently drop every IQ Room attempt.
      if (a.iqRoomId) return true;
      // Company tests bypass the normal org TestAssignment acceptance gate
      if (a.testCategory === "COMPANY") return true;
      const testId = String(a.testId?._id || a.testId || "");
      const assignment = assignmentMap.get(testId);
      return Boolean(assignment?.acceptedAt) && assignment.status !== "DECLINED";
    });

    // Map to frontend-friendly shape
    return acceptedAttempts.map((a) => {
      const test = a.testId || {};
      const testName = test.title || (test.testCode ? `Test (${test.testCode})` : 'Untitled Test');
      const testType = test.testSeriesId ? 'Test Series' : 'Single Test';
      const seriesName = test.testSeriesId ? (test.testSeriesId.title || null) : null;
      const company = a.companyId || (test.companyId && typeof test.companyId === "object" ? test.companyId : null);
      const resolvedTotalMarks =
        Number.isFinite(a.maxScore) && a.maxScore > 0
          ? a.maxScore
          : (Number.isFinite(test.totalMarks) ? test.totalMarks : 0);
      let resolvedScore = Number.isFinite(a.totalScore) ? a.totalScore : 0;
      if (resolvedScore <= 0 && Number.isFinite(a.percentage) && a.percentage > 0 && resolvedTotalMarks > 0) {
        resolvedScore = Math.round((a.percentage / 100) * resolvedTotalMarks);
      }
      const resolvedPercentage = Number.isFinite(a.percentage)
        ? Math.round(a.percentage)
        : (resolvedTotalMarks > 0 ? Math.round((resolvedScore / resolvedTotalMarks) * 100) : 0);

      return {
        id: String(a._id),
        testId: String(test._id || a.testId),
        testName,
        testType,
        seriesName,
        testCategory: a.testCategory || "GENERAL",
        company: company ? { id: String(company._id), name: company.name, slug: company.slug, logoUrl: company.logoUrl } : null,
        companyStage: test.companyStage || null,
        attemptDate: a.submittedAt ? new Date(a.submittedAt).toISOString().split('T')[0] : null,
        attemptTime: a.submittedAt ? new Date(a.submittedAt).toISOString().split('T')[1]?.slice(0,5) : null,
        totalQuestions: test.totalQuestions || a.totalQuestions || 0,
        duration: test.duration ? `${test.duration} mins` : (a.duration ? `${a.duration} mins` : ''),
        score: resolvedScore,
        totalMarks: resolvedTotalMarks,
        percentage: resolvedPercentage,
        status: a.status === "MISSED" ? "missed" : (a.resultStatus || '').toLowerCase(),
        allowDownload: a.status === "MISSED" ? false : true,
        createdBy: (test.createdBy && test.createdBy.role) || '',
        isIQRoomTest: Boolean(test.isIQRoomTest),
        submittedAt: a.submittedAt,
        evaluatedAt: a.evaluatedAt,
      };
    });
  } catch (error) {
    throw error;
  }
};