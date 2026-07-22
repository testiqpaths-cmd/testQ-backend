// modules/testAttempts/testAttempt.controller.js
import { normalizeAttemptQuestion } from "./services/questionSelection.service.js";
import { manualEvaluateAttempt } from "./services/manualEvaluateAttempt.service.js";
import { evaluateAttemptSchema } from "./schemas/evaluateAttempt.schema.js";
import { getAttemptResult } from "./services/getAttemptResult.service.js";
import { getDetailedAnalysis } from "./services/getDetailedAnalysis.service.js";
import * as service from "./services/testAttempt.service.js";

export const startTestAttemptController = async (req, res, next) => {
  try {
    const { testId } = req.params;
    const studentId = req.user?._id;
    const { iqRoomId } = req.body;

    const result = await service.startTestAttemptService({
      testId,
      studentId,
      iqRoomId,
      user: req.user,
    });

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        ...(result.data !== undefined ? { data: result.data } : {}),
      });
    }

    return res.status(201).json({
      success: true,
      message: "Test attempt started",
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
};

// src/modules/testAttempts/controllers/testAttempt.controller.js
export const getAttemptController = async (req, res, next) => {
  try {
    const attempt = req.attempt;
    const timing = req.timing;
    const test = await service.getAttemptTestSummaryService(attempt.testId);

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
              createdBy: test.createdBy,
              isIQRoomTest: test.isIQRoomTest,
            }
          : null,
        attempt: {
          _id: attempt._id,
          testId: attempt.testId,
          iqRoomId: attempt.iqRoomId,
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

    const result = await service.saveAnswerService(attempt, timing, req.body);

    if (result.error) {
      return res.status(result.status).json({
        success: false,
        message: result.error,
        errors: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Answer saved successfully",
      data: {
        attemptId: attempt._id,
        questionId: result.questionId,
        timeSpentMs: result.timeSpentMs,
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

    const result = await service.submitAttemptService(attempt, timing, req.body);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        data: result.data,
      });
    }

    return res.json({
      success: true,
      message: "Test submitted successfully",
      data: result.data,
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

    const result = await service.getEvaluationStatusService(attemptId);

    if (result.error) {
      return res.status(result.status).json({
        success: false,
        message: result.error,
      });
    }

    return res.json({
      success: true,
      message: "Evaluation status retrieved",
      data: result.data,
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

    // ✅ Student can view own results. Admins and Organizations can view student results.
    const requesterId = String(req.user?._id);
    const requesterRole = req.user?.role;
    const ownerId = String(attempt.studentId);

    if (requesterId !== ownerId && requesterRole !== "IQPATH_ADMIN" && requesterRole !== "ORGANIZATION") {
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
        cheatingScore: attempt.cheatingScore,
        violations: attempt.violations,
        analysis,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const getDetailedAnalysisController = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const detailedAnalysis = await getDetailedAnalysis(attemptId);

    if (!detailedAnalysis) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found",
        errors: null,
      });
    }

    // You could also add owner validation here similar to getAttemptResultController if needed

    return res.status(200).json({
      success: true,
      message: "Detailed analysis fetched successfully",
      data: detailedAnalysis,
    });
  } catch (err) {
    return next(err);
  }
};

export const updateCheatingStatusController = async (req, res, next) => {
  try {
    const attempt = req.attempt;

    const result = await service.updateCheatingStatusService(attempt, req.body);

    if (result.error) {
      return res.status(result.status).json({
        success: false,
        message: result.error,
        errors: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cheating status updated successfully",
      data: result.data,
    });
  } catch (err) {
    next(err);
  }
};
