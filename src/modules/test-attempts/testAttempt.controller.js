// modules/testAttempts/testAttempt.controller.js
import mongoose from "mongoose";
import Test from "../../models/test.model.js"; // adjust path
import TestAttempt from "../../models/testAttempt.model.js"; // adjust path";
import { computeAttemptTiming } from "../test-attempts/utils/attemptTimer.util.js";
import { saveAnswerSchema } from "./schemas/saveAnswer.schema.js";
import { evaluateObjectiveForAttempt } from "./services/evaluateObjectiveAttempts.service.js";
import { manualEvaluateAttempt } from "./services/manualEvaluateAttempt.service.js";
import { evaluateAttemptSchema } from "./schemas/evaluateAttempt.schema.js";

export const startTestAttemptController = async (req, res, next) => {
  try {
    const { testId } = req.params;
    const studentId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(testId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid testId" });
    }

    // 1) Load test
    const test = await Test.findById(testId).lean();
    if (!test) {
      return res
        .status(404)
        .json({ success: false, message: "Test not found" });
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
      // Calculate timing for existing attempt
      const existingTiming = computeAttemptTiming(existing);
      return res.status(409).json({
        success: false,
        message: "Attempt already exists for this test",
        data: {
          attemptId: existing._id,
          status: existing.status,
          startedAt: existing.startedAt,
          endsAt: existing.endsAt,
          duration: existing.duration,
          maxScore: existing.maxScore,
          timing: existingTiming, // ✅ backend remaining time
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

    const timing = computeAttemptTiming(attempt);
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
        timing, // ✅ backend remaining time
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

// src/modules/testAttempts/controllers/testAttempt.controller.js
export const getAttemptController = async (req, res, next) => {
  try {
    const attempt = req.attempt;
    const timing = req.timing;

    // Return timing and attempt status to frontend
    return res.json({
      success: true,
      message: "Attempt retrieved",
      data: {
        attempt: {
          _id: attempt._id,
          testId: attempt.testId,
          studentId: attempt.studentId,
          status: attempt.status,
          startedAt: attempt.startedAt,
          endsAt: attempt.endsAt,
          duration: attempt.duration,
          submittedAt: attempt.submittedAt,
          expireReason: attempt.expireReason,
          answers: attempt.answers,
          maxScore: attempt.maxScore,
          totalScore: attempt.totalScore,
          percentage: attempt.percentage,
          resultStatus: attempt.resultStatus,
        },
        timing: {
          remainingSeconds: timing.remainingSeconds,
          remainingMs: timing.remainingMs,
          expired: timing.expired,
          // ✅ Backend-only: frontend cannot modify timeouts
          serverNow: timing.serverNow,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

export const saveAnswerController = async (req, res, next) => {
  try {
    const attempt = req.attempt; // from loadAttempt
    const timing = req.timing; // from enforceAttemptTimer

    // ✅ Block if not in progress (Acceptance Criteria)
    if (attempt.status !== "IN_PROGRESS") {
      return res.status(409).json({
        success: false,
        message: "Attempt is not in progress",
        errors: null,
      });
    }

    // ✅ If timer says expired, block (your middleware may auto-expire already)
    if (timing?.expired) {
      return res.status(409).json({
        success: false,
        message: "Time expired. Attempt ended.",
        errors: null,
      });
    }

    // ✅ Validate request body
    const parsed = saveAnswerSchema.parse(req.body);
    const questionId = new mongoose.Types.ObjectId(parsed.questionId);

    // ✅ Upsert by questionId (no duplicates)
    const idx = attempt.answers.findIndex(
      (a) => a.questionId.toString() === questionId.toString(),
    );

    const updatedAnswer = {
      questionId,
      selectedOption: parsed.selectedOption ?? null,
      textAnswer: parsed.textAnswer ?? null,
      answeredAt: new Date(),
    };

    if (idx >= 0) {
      // update existing entry
      attempt.answers[idx].selectedOption = updatedAnswer.selectedOption;
      attempt.answers[idx].textAnswer = updatedAnswer.textAnswer;
      attempt.answers[idx].answeredAt = updatedAnswer.answeredAt;
    } else {
      // add new entry
      attempt.answers.push(updatedAnswer);
    }

    await attempt.save();

    return res.status(200).json({
      success: true,
      message: "Answer saved successfully",
      data: {
        attemptId: attempt._id,
        questionId: parsed.questionId,
        timing: req.timing,
      },
    });
  } catch (err) {
    // Zod error
    if (err?.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: err.errors,
      });
    }
    return next(err);
  }
};

export const submitAttemptController = async (req, res, next) => {
  try {
    const attempt = req.attempt;
    const timing = req.timing;

    // ✅ If timer expired, middleware already set EXPIRED
    // Return clear message that time is up
    if (attempt.status === "EXPIRED") {
      return res.json({
        success: true,
        message: "Attempt auto-expired due to time over",
        data: {
          status: "EXPIRED",
          expireReason: attempt.expireReason,
          submittedAt: attempt.submittedAt,
          timing: {
            remainingSeconds: 0,
            remainingMs: 0,
            expired: true,
            serverNow: timing.serverNow,
          },
        },
      });
    }

    // Prevent submission if not in progress and not already expired
    if (attempt.status !== "IN_PROGRESS") {
      return res.status(409).json({
        success: false,
        message: `Cannot submit attempt - status is ${attempt.status.toLowerCase()}`,
        data: {
          status: attempt.status,
          submittedAt: attempt.submittedAt,
          timing: {
            remainingSeconds: timing.remainingSeconds,
            remainingMs: timing.remainingMs,
            expired: timing.expired,
            serverNow: timing.serverNow,
          },
        },
      });
    }

    // ✅ Manually submit before time expires
    attempt.status = "SUBMITTED";
    attempt.submittedAt = new Date();
    attempt.expireReason = "MANUAL_SUBMIT";
    await attempt.save();

    const evaluatedAttempt = await evaluateObjectiveForAttempt(attempt._id);

    return res.json({
      success: true,
      message: "Test submitted successfully",
      data: {
        status: evaluatedAttempt?.status || "SUBMITTED",
        submittedAt: evaluatedAttempt?.submittedAt || attempt.submittedAt,
        totalScore: evaluatedAttempt?.totalScore ?? 0,
        percentage: evaluatedAttempt?.percentage ?? 0,
        timing: {
          remainingSeconds: Math.max(0, timing.remainingSeconds),
          remainingMs: Math.max(0, timing.remainingMs),
          expired: false,
          serverNow: timing.serverNow,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};


export const evaluateAttemptController = async (req, res, next) => {
  try {
    

    const parsed = evaluateAttemptSchema.parse(req.body);
    const { attemptId } = req.params;
    const { evaluations } = parsed;     // ✅


    const result = await manualEvaluateAttempt(attemptId, evaluations);

    if (result?.error) {
      return res.status(result.status || 400).json({
        success: false,
        message: result.error,
        errors: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Attempt evaluated successfully",
      data: {
        attemptId: result.attempt._id,
        status: result.attempt.status,
        totalScore: result.attempt.totalScore,
        percentage: result.attempt.percentage,
      },
    });
  } catch (err) {
    return next(err);
  }
};
