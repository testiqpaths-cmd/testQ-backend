// src/modules/testAttempts/services/attemptTimer.service.js
import { findAttemptByIdRepo, saveAttemptRepo } from "../repositories/testAttempt.repository.js";

/**
 * Check if an attempt has exceeded its time limit
 * timeElapsed = now - attempt.startedAt
 * if (timeElapsed >= attempt.duration) autoSubmit()
 */
export const checkAttemptExpiry = (attempt) => {
  if (!attempt) {
    return {
      isExpired: false,
      remainingMs: 0,
      remainingSeconds: 0,
      timeElapsedMs: 0,
      now: new Date(),
    };
  }

  const now = new Date();
  const startedAt = new Date(attempt.startedAt);
  const endsAt = new Date(attempt.endsAt);

  const timeElapsedMs = now.getTime() - startedAt.getTime();
  const durationMs = attempt.duration * 60 * 1000;
  const rawRemainingMs = endsAt.getTime() - now.getTime();

  const isClosedStatus = ["SUBMITTED", "EVALUATED", "EXPIRED"].includes(
    attempt.status
  );

  const isExpired =
    rawRemainingMs <= 0 ||
    timeElapsedMs >= durationMs ||
    attempt.expireReason === "TIME_EXPIRED_AUTO_SUBMIT" ||
    isClosedStatus;

  return {
    isExpired,
    remainingMs: isClosedStatus ? 0 : Math.max(0, rawRemainingMs),
    remainingSeconds: isClosedStatus
      ? 0
      : Math.max(0, Math.floor(rawRemainingMs / 1000)),
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

  await saveAttemptRepo(attempt);
  return attempt;
};

/**
 * Auto-expire by ID
 */
export const autoExpireAttemptById = async (
  attemptId,
  reason = "TIME_EXPIRED"
) => {
  const attempt = await findAttemptByIdRepo(attemptId);
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