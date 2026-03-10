export const computeAttemptTiming = (attempt) => {
  const nowMs = Date.now();
  const endsAtMs = new Date(attempt.endsAt).getTime();
  const remainingMs = Math.max(0, endsAtMs - nowMs);

  const timeOver = nowMs >= endsAtMs; // true only if clock ended

  return {
    serverNow: new Date(nowMs),
    remainingMs,
    remainingSeconds: Math.floor(remainingMs / 1000),
    timeOver,
  };
};
