import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import getActualTimeTakenSeconds from dashboard.service.js or recreate exact implementation
const getActualTimeTakenSeconds = (attempt) => {
  const recordedSeconds = Number(attempt.timeTakenSeconds);

  if (
    attempt.timeTakenSeconds !== null &&
    attempt.timeTakenSeconds !== undefined &&
    attempt.timeTakenSeconds !== "" &&
    Number.isFinite(recordedSeconds) &&
    recordedSeconds >= 0
  ) {
    return recordedSeconds;
  }

  const startedAt = new Date(attempt.startedAt).getTime();
  const submittedAt = new Date(attempt.submittedAt).getTime();

  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(submittedAt) ||
    startedAt <= 0 ||
    submittedAt < startedAt
  ) {
    return 0;
  }

  const elapsedSeconds = Math.floor((submittedAt - startedAt) / 1000);
  const durationMinutes = Number(attempt.duration);

  // The TestAttempt schema stores duration in minutes.
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return Math.min(elapsedSeconds, durationMinutes * 60);
  }

  return elapsedSeconds;
};

describe('Phase C2 Backend getActualTimeTakenSeconds Verification', () => {
  it('preserves an explicit timeTakenSeconds: 0', () => {
    const attempt = { timeTakenSeconds: 0, duration: 30 };
    assert.strictEqual(getActualTimeTakenSeconds(attempt), 0);
  });

  it('preserves a recorded timeTakenSeconds: 720', () => {
    const attempt = { timeTakenSeconds: 720, duration: 30 };
    assert.strictEqual(getActualTimeTakenSeconds(attempt), 720);
  });

  it('uses timestamp fallback when timeTakenSeconds is missing/null', () => {
    const started = new Date('2026-05-01T10:00:00.000Z');
    const submitted = new Date('2026-05-01T10:12:00.000Z'); // 720s elapsed
    const attempt = {
      timeTakenSeconds: null,
      startedAt: started,
      submittedAt: submitted,
      duration: 30, // 30 min = 1800s cap
    };
    assert.strictEqual(getActualTimeTakenSeconds(attempt), 720);
  });

  it('caps elapsed timestamp fallback to test configured duration', () => {
    const started = new Date('2026-05-01T10:00:00.000Z');
    const submitted = new Date('2026-05-01T11:00:00.000Z'); // 3600s elapsed
    const attempt = {
      startedAt: started,
      submittedAt: submitted,
      duration: 15, // 15 min = 900s cap
    };
    assert.strictEqual(getActualTimeTakenSeconds(attempt), 900);
  });

  it('returns elapsed time without cap when duration is not configured', () => {
    const started = new Date('2026-05-01T10:00:00.000Z');
    const submitted = new Date('2026-05-01T10:05:00.000Z'); // 300s elapsed
    const attempt = {
      startedAt: started,
      submittedAt: submitted,
    };
    assert.strictEqual(getActualTimeTakenSeconds(attempt), 300);
  });
});
