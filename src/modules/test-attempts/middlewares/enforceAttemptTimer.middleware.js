// src/modules/testAttempts/middlewares/enforceAttemptTimer.middleware.js
import TestAttempt from "../../../models/testAttempt.model.js";
import { computeAttemptTiming } from "../utils/attemptTimer.util.js";
import {
  autoExpireAttempt,
  checkAttemptExpiry,
} from "../services/attemptTimer.service.js";

/**
 * Load attempt from database
 * Validates that the attempt exists and belongs to the authenticated user
 */
export const loadAttempt = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const userId = req.user?._id;

    const attempt = await TestAttempt.findById(attemptId);

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found",
      });
    }

    // Verify ownership (optional but recommended for security)
    if (attempt.studentId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: This is not your attempt",
      });
    }

    req.attempt = attempt;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Enforce timer by checking if time has expired
 * If expired, auto-expires the attempt and prevents further actions
 *
 * ✅ Ensures backend time is the source of truth
 * ✅ Frontend timer is display-only
 */
export const enforceAttemptTimer = async (req, res, next) => {
  try {
    const attempt = req.attempt;

    // If attempt is not in progress, skip expiry check
    if (attempt.status !== "IN_PROGRESS") {
      req.timing = {
        remainingSeconds: 0,
        remainingMs: 0,
        expired: false, // ✅ not time-expired; it's just ended
        ended: true, // ✅ attempt ended (SUBMITTED/EXPIRED/etc.)
        endReason: attempt.expireReason || attempt.status,
        serverNow: new Date(),
      };
      return next();
    }

    // Calculate remaining time using backend logic only
    const timing = computeAttemptTiming(attempt);
    req.timing = timing;

    // If not expired, proceed normally
    if (!timing.expired) {
      return next();
    }

    // ✅ Time is up: auto-expire the attempt
    await autoExpireAttempt(attempt, "TIME_EXPIRED");

    // Refresh attempt for downstream controllers
    const updated = await TestAttempt.findById(attempt._id);
    req.attempt = updated;
    req.timing = {
      remainingSeconds: 0,
      remainingMs: 0,
      expired: true,
      serverNow: new Date(),
    };

    return next();
  } catch (err) {
    return next(err);
  }
};
