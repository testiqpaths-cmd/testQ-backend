// modules/testAttempts/testAttempt.controller.js
import mongoose from "mongoose";
import Test from "../../models/test.model.js"; // adjust path
import TestAttempt from "../../models/testAttempt.model.js"; // adjust path";
import { computeAttemptTiming } from "../test-attempts/utils/attemptTimer.util.js";
import { saveAnswerSchema } from "./schemas/saveAnswer.schema.js";
import { evaluateObjectiveForAttempt } from "./services/evaluateObjectiveAttempts.service.js";
import { manualEvaluateAttempt } from "./services/manualEvaluateAttempt.service.js";
import { evaluateAttemptSchema } from "./schemas/evaluateAttempt.schema.js";
import { getAttemptResult } from "./services/getAttemptResult.service.js";
import {
  normalizeAttemptQuestion,
  selectAttemptQuestions,
} from "./services/questionSelection.service.js";

const canStartTest = (test, user) => {
  if (!test || !user) return false;

  if (test.visibility === "PUBLIC") return true;
  if (test.visibility === "LINK_ONLY") return true;

  if (test.visibility === "ORG_ONLY") {
    const userOrganizationId = String(user.organizationId || "");
    if (!userOrganizationId) return false;

    const allowedOrganizations = Array.isArray(test.allowedOrganizations)
      ? test.allowedOrganizations.map((id) => String(id))
      : [];

    return allowedOrganizations.length === 0 || allowedOrganizations.includes(userOrganizationId);
  }

  return false;
};

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

    // 2) Validate visibility and organization access
    if (!canStartTest(test, req.user)) {
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

    // 4) Prevent multiple in-progress attempts and enforce maxAttempts
    // Check if there is an in-progress attempt
    const existingInProgress = await TestAttempt.findOne({ testId, studentId, status: 'IN_PROGRESS' }).lean();
    if (existingInProgress) {
      const existingTiming = computeAttemptTiming(existingInProgress);
      return res.status(409).json({
        success: false,
        message: 'Attempt already exists for this test',
        data: {
          attemptId: existingInProgress._id,
          status: existingInProgress.status,
          startedAt: existingInProgress.startedAt,
          endsAt: existingInProgress.endsAt,
          duration: existingInProgress.duration,
          maxScore: existingInProgress.maxScore,
          timing: existingTiming,
        },
      });
    }

    // Count completed/submitted attempts to enforce maxAttempts
    const completedAttemptsCount = await TestAttempt.countDocuments({
      testId,
      studentId,
      status: { $in: ['SUBMITTED', 'EVALUATED'] },
    });

    const allowedAttempts = Number(test.maxAttempts) || 1;
    if (completedAttemptsCount >= allowedAttempts) {
      return res.status(403).json({
        success: false,
        message: 'Maximum attempts reached for this test',
      });
    }

    const { questionSnapshots, questions } = await selectAttemptQuestions(test);

    if (!questionSnapshots.length) {
      return res.status(400).json({
        success: false,
        message: "No eligible questions were found for this test",
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
      questionSnapshots,
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
        questions,
        timing, // ✅ backend remaining time
      },
    });
  } catch (err) {
    // Handle unique index error (one attempt per student per test)
    if (err?.code === 11000) {
      const { testId, studentId } = req.params ? { testId: req.params.testId, studentId: req.user?._id } : {};
      const existingAttempt = await TestAttempt.findOne({
        testId,
        studentId,
        status: 'IN_PROGRESS',
      }).lean();

      return res.status(409).json({
        success: false,
        message: "Attempt already exists for this test",
        data: existingAttempt
          ? {
              attemptId: existingAttempt._id,
              status: existingAttempt.status,
              startedAt: existingAttempt.startedAt,
              endsAt: existingAttempt.endsAt,
              duration: existingAttempt.duration,
              maxScore: existingAttempt.maxScore,
            }
          : undefined,
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
    const test = await Test.findById(attempt.testId).select("title duration").lean();

    const questions = Array.isArray(attempt.questionSnapshots)
      ? attempt.questionSnapshots.map((snapshot) => normalizeAttemptQuestion(snapshot))
      : [];

    // Return timing and attempt status to frontend
    return res.json({
      success: true,
      message: "Attempt retrieved",
      data: {
        test: test
          ? {
              _id: attempt.testId,
              title: test.title,
              duration: test.duration,
            }
          : null,
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
        questions,
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
    const timeSpentMs = Number(parsed.timeSpentMs || 0);

    const snapshotIndex = Array.isArray(attempt.questionSnapshots)
      ? attempt.questionSnapshots.findIndex(
          (item) => item.questionId.toString() === questionId.toString(),
        )
      : -1;

    if (snapshotIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Question is not part of this attempt",
        errors: null,
      });
    }

    const snapshot = attempt.questionSnapshots[snapshotIndex];
    if (Number.isFinite(timeSpentMs) && timeSpentMs > 0) {
      snapshot.timeSpentMs = (snapshot.timeSpentMs || 0) + timeSpentMs;
      snapshot.lastViewedAt = new Date();
      if (!snapshot.startedAt) {
        snapshot.startedAt = snapshot.lastViewedAt;
      }
    }

    // ✅ Upsert by questionId (no duplicates)
    const idx = attempt.answers.findIndex(
      (a) => a.questionId.toString() === questionId.toString(),
    );

    const updatedAnswer = {
      questionId,
      selectedOption: parsed.selectedOption ?? null,
      textAnswer: parsed.textAnswer ?? null,
      answeredAt: new Date(),
      timeSpentMs: Number.isFinite(timeSpentMs) ? timeSpentMs : 0,
    };

    if (parsed.selectedOption !== undefined || parsed.textAnswer !== undefined) {
      updatedAnswer.timeSpentMs = snapshot.timeSpentMs || updatedAnswer.timeSpentMs;

      if (idx >= 0) {
        // update existing entry
        attempt.answers[idx].selectedOption = updatedAnswer.selectedOption;
        attempt.answers[idx].textAnswer = updatedAnswer.textAnswer;
        attempt.answers[idx].answeredAt = updatedAnswer.answeredAt;
        attempt.answers[idx].timeSpentMs = updatedAnswer.timeSpentMs;
      } else {
        // add new entry
        attempt.answers.push(updatedAnswer);
      }
    } else if (idx >= 0) {
      attempt.answers[idx].timeSpentMs = snapshot.timeSpentMs || attempt.answers[idx].timeSpentMs || 0;
    }

    await attempt.save();

    return res.status(200).json({
      success: true,
      message: "Answer saved successfully",
      data: {
        attemptId: attempt._id,
        questionId: parsed.questionId,
        timeSpentMs: snapshot.timeSpentMs || 0,
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
        attemptId: attempt._id.toString(),
        testId: attempt.testId,
        resultId: attempt._id.toString(), // ✅ attemptId IS the result
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
        maxScore: result.attempt.maxScore,
        resultStatus: result.attempt.resultStatus,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * Get evaluation status by attemptId
 * Returns evaluation type and status for determining redirect/display
 */
export const getEvaluationStatusController = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(attemptId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid attemptId",
      });
    }

    const attempt = await TestAttempt.findById(attemptId)
      .select("testId status submittedAt totalScore percentage maxScore answers questionSnapshots")
      .lean();

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found",
      });
    }

    const test = await Test.findById(attempt.testId)
      .select("title evaluationType")
      .lean();

    // Determine evaluation type: auto (all MCQ), manual (has subjective), hybrid (mixed)
    const hasSubjective = Array.isArray(attempt.questionSnapshots) &&
      attempt.questionSnapshots.some(q => q.type === "SUBJECTIVE" || q.type === "SHORT_ANSWER");

    const evaluationType = hasSubjective ? "hybrid" : "auto";
    const evaluationStatus = attempt.status === "SUBMITTED" || attempt.status === "EVALUATED" ? "completed" : "pending";

    // Calculate analytics
    const totalQuestions = attempt.questionSnapshots?.length || 0;
    const attemptedQuestions = attempt.answers?.length || 0;
    const correctAnswers = attempt.answers?.filter(a => a.isCorrect === true)?.length || 0;

    return res.json({
      success: true,
      message: "Evaluation status retrieved",
      data: {
        testId: attempt.testId,
        attemptId: attemptId,
        testName: test?.title || "Test",
        evaluationType,
        evaluationStatus,
        submittedAt: attempt.submittedAt,
        totalScore: attempt.totalScore || 0,
        maxScore: attempt.maxScore || 0,
        percentage: attempt.percentage || 0,
        analytics: {
          total: totalQuestions,
          attempted: attemptedQuestions,
          unattempted: totalQuestions - attemptedQuestions,
          correct: correctAnswers,
          incorrect: attemptedQuestions - correctAnswers,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getAttemptResultController = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const result = await getAttemptResult(attemptId);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found",
        errors: null,
      });
    }
    const attempt = result.attempt || result;
    const analysis = result.analysis || null;

    // ✅ Student can view own results only
    const requesterId = String(req.user?._id);
    const ownerId = String(attempt.studentId);

    if (requesterId !== ownerId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this result",
        errors: null,
      });
    }

    // ✅ Results visible after submission (whether fully evaluated or pending)
    if (attempt.status !== "EVALUATED" && attempt.status !== "SUBMITTED") {
      return res.status(409).json({
        success: false,
        message: "Result is not available yet. Attempt not submitted.",
        errors: null,
      });
    }

    // ✅ Return complete attempt data with all necessary fields for frontend transformation
    return res.status(200).json({
      success: true,
      message: "Result fetched successfully",
      data: {
        _id: attempt._id,
        testId: attempt.testId,
        studentId: attempt.studentId,
        status: attempt.status,
        totalScore: analysis?.totalScore ?? attempt.totalScore,
        maxScore: analysis?.maxScore ?? attempt.maxScore,
        percentage: analysis?.percentage ?? attempt.percentage,
        resultStatus: attempt.resultStatus,
        submittedAt: attempt.submittedAt,
        startedAt: attempt.startedAt,
        answers: attempt.answers, // ✅ Includes correctAnswer from enrichment
        questionSnapshots: attempt.questionSnapshots, // ✅ Original snapshots
        analysis,
      },
    });
  } catch (err) {
    return next(err);
  }
};
