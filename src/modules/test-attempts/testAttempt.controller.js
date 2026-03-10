// modules/testAttempts/testAttempt.controller.js
import mongoose from "mongoose";
import Test from "../../models/test.model.js"; // adjust path
import TestAttempt from "../../models/testAttempt.model.js"; // adjust path

export const startTestAttemptController = async (req, res, next) => {
  try {
    const { testId } = req.params;
    const studentId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(testId)) {
      return res.status(400).json({ success: false, message: "Invalid testId" });
    }

    // 1) Load test
    const test = await Test.findById(testId).lean();
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }

    // 2) Validate visibility (adapt to your rules)
    // Example: only PUBLIC can be started directly
    if (test.visibility !== "PUBLIC") {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to start this test",
      });
    }

    // 3) Validate schedule (adapt to your test fields)
    // Example fields: test.startTime, test.endTime (Date)
    const now = new Date();
    if (test.startTime && now < new Date(test.startTime)) {
      return res.status(400).json({
        success: false,
        message: "Test has not started yet",
      });
    }
    if (test.endTime && now > new Date(test.endTime)) {
      return res.status(400).json({
        success: false,
        message: "Test has already ended",
      });
    }

    // 4) Prevent multiple attempts (fast check)
    const existing = await TestAttempt.findOne({ testId, studentId }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Attempt already exists for this test",
        data: {
          attemptId: existing._id,
          status: existing.status,
          startedAt: existing.startedAt,
          endsAt: existing.endsAt,
        },
      });
    }

    // 5) Copy duration & marks server-side
    const duration = Number(test.duration); // minutes (recommended)
    const maxScore = Number(test.totalMarks);

    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(500).json({
        success: false,
        message: "Test duration is invalid on server",
      });
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      return res.status(500).json({
        success: false,
        message: "Test totalMarks is invalid on server",
      });
    }

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + duration * 60 * 1000);

    // Optional: also cap by test.endTime if you want hard stop
    // if (test.endTime && endsAt > new Date(test.endTime)) endsAt = new Date(test.endTime);

    // 6) Create attempt
    const attempt = await TestAttempt.create({
      testId,
      studentId,
      startedAt,
      endsAt,
      duration,
      maxScore,
      status: "IN_PROGRESS",
      answers: [],
    });

    return res.status(201).json({
      success: true,
      message: "Test attempt started",
      data: {
        attemptId: attempt._id,
        testId: attempt.testId,
        studentId: attempt.studentId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        endsAt: attempt.endsAt,
        duration: attempt.duration,
        maxScore: attempt.maxScore,
      },
    });
  } catch (err) {
    // Handle unique index error (one attempt per student per test)
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Attempt already exists for this test",
      });
    }
    return next(err);
  }
};
