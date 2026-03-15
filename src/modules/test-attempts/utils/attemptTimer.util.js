// attemptTimer.util.js
export const computeAttemptTiming = (attempt) => {
  const serverNow = new Date();
  const endsAt = new Date(attempt.endsAt);

  const remainingMs = endsAt.getTime() - serverNow.getTime();
  const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

  return {
    serverNow,
    remainingMs,
    remainingSeconds,
    expired: remainingMs <= 0,
  };
};