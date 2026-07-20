import TestAttempt from "../../../../models/testAttempt.model.js";
import mongoose from "mongoose";

export const findAttemptsByStudent = async (studentId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      throw new Error("Invalid student id");
    }

    const attempts = await TestAttempt.find({
      studentId: new mongoose.Types.ObjectId(studentId),
      status: { $in: ["SUBMITTED", "EVALUATED", "MISSED"] },
    })
      .select(
        "testId totalScore maxScore percentage resultStatus status submittedAt evaluatedAt totalQuestions duration"
      )
      .populate({ path: 'testId', select: 'title duration totalQuestions testSeriesId totalMarks createdBy isIQRoomTest' })
      .sort({ submittedAt: -1 })
      .lean();

    // Map to frontend-friendly shape
    return attempts.map((a) => {
      const test = a.testId || {};
      const testName = test.title || (test.testCode ? `Test (${test.testCode})` : 'Untitled Test');
      const testType = test.testSeriesId ? 'Test Series' : 'Single Test';
      const seriesName = test.testSeriesId ? String(test.testSeriesId) : null;
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