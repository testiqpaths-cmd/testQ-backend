// src/modules/testAttempts/services/attemptTimer.service.js
import TestAttempt from "../../../models/testAttempt.model.js";
import Test from "../../../models/test.model.js";

/**
 * Check if an attempt has exceeded its time limit
 * timeElapsed = now - attempt.startedAt
 * if (timeElapsed >= attempt.duration) autoSubmit()
 */
export const checkAttemptExpiry = (attempt) => {
  if (!attempt || attempt.status !== "IN_PROGRESS") {
    return { isExpired: false };
  }

  const now = new Date();
  const startedAt = new Date(attempt.startedAt);
  const endsAt = new Date(attempt.endsAt);

  const timeElapsedMs = now.getTime() - startedAt.getTime();
  const durationMs = attempt.duration * 60 * 1000; // duration is in minutes
  const remainingMs = endsAt.getTime() - now.getTime();

  return {
    isExpired: now >= endsAt || timeElapsedMs >= durationMs,
    remainingMs: Math.max(0, remainingMs),
    remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
    timeElapsedMs,
    now,
  };
};

/**
 * Auto-expire an attempt when time is up
 * Marks status as EXPIRED and records the submission time
 */
export const autoExpireAttempt = async (attempt, reason = "TIME_EXPIRED") => {
  if (!attempt) return null;
  
  // Only expire if currently in progress
  if (attempt.status !== "IN_PROGRESS") {
    return attempt;
  }

  attempt.status = "EXPIRED";
  attempt.submittedAt = new Date();
  attempt.expireReason = reason;

  await attempt.save();
  return attempt;
};

/**
 * Auto-expire by ID
 */
export const autoExpireAttemptById = async (attemptId, reason = "TIME_EXPIRED") => {
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt) return null;
  return autoExpireAttempt(attempt, reason);
};

/**
 * Helper to validate remaining time before action
 * Used to ensure frontend timer is treated as display-only
 */
export const getRemainingTime = (attempt) => {
  const expiry = checkAttemptExpiry(attempt);
  return {
    remainingSeconds: expiry.remainingSeconds,
    remainingMs: expiry.remainingMs,
    isExpired: expiry.isExpired,
    serverTime: expiry.now,
  };
};
