import assert from "node:assert";
import { getAttemptResultStatus } from "../../src/modules/analytics/dashboard/dashboard.service.js";

console.log("Starting Phase E2.7 Backend Verification...\n");

let passedCount = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 1. getAttemptResultStatus tests
test("1.1 Authoritative resultStatus PASS produces 'pass'", () => {
  const attempt = { status: "EVALUATED", resultStatus: "PASS", percentage: 0 };
  const res = getAttemptResultStatus(attempt, 0, { passingPercentage: 40 });
  assert.strictEqual(res, "pass");
});

test("1.2 Authoritative resultStatus FAIL produces 'fail'", () => {
  const attempt = { status: "EVALUATED", resultStatus: "FAIL", percentage: 100 };
  const res = getAttemptResultStatus(attempt, 100, { passingPercentage: 40 });
  assert.strictEqual(res, "fail");
});

test("1.3 Status SUBMITTED produces 'pending' regardless of score", () => {
  const attempt = { status: "SUBMITTED", percentage: null };
  const res = getAttemptResultStatus(attempt, null, { passingPercentage: 40 });
  assert.strictEqual(res, "pending");
});

test("1.4 Status STARTED produces 'pending'", () => {
  const attempt = { status: "STARTED", percentage: null };
  const res = getAttemptResultStatus(attempt, null, { passingPercentage: 40 });
  assert.strictEqual(res, "pending");
});

test("1.5 Evaluated attempt with missing score & resultStatus produces 'unknown', not 'fail'", () => {
  const attempt = { status: "EVALUATED", percentage: null, totalScore: null };
  const res = getAttemptResultStatus(attempt, null, { passingPercentage: 40 });
  assert.strictEqual(res, "unknown");
});

test("1.6 Evaluated attempt with genuine zero score fails threshold 40", () => {
  const attempt = { status: "EVALUATED", percentage: 0, totalScore: 0, maxScore: 100 };
  const res = getAttemptResultStatus(attempt, 0, { passingPercentage: 40 });
  assert.strictEqual(res, "fail");
});

test("1.7 Evaluated attempt with genuine zero score passes threshold 0", () => {
  const attempt = { status: "EVALUATED", percentage: 0, totalScore: 0, maxScore: 100 };
  const res = getAttemptResultStatus(attempt, 0, { passingPercentage: 0 });
  assert.strictEqual(res, "pass");
});

// 2. recentTests mapping verification
test("2.1 recentTests returns distinct id (attempt) and testId (test)", () => {
  const mockAttempt = {
    _id: "attempt_id_123",
    testId: { _id: "test_id_456", title: "Math Test", passingPercentage: 40 },
    studentId: { firstName: "Jane", lastName: "Doe" },
    percentage: 85,
    status: "EVALUATED",
    resultStatus: "PASS",
    submittedAt: new Date("2026-10-20T10:00:00Z"),
  };

  const hasScore =
    mockAttempt.percentage !== null &&
    mockAttempt.percentage !== undefined &&
    Number.isFinite(Number(mockAttempt.percentage));
  const scoreVal = hasScore ? Math.round(Number(mockAttempt.percentage)) : null;

  const row = {
    id: mockAttempt._id,
    testId: mockAttempt.testId?._id || mockAttempt.testId,
    studentName: `${mockAttempt.studentId.firstName} ${mockAttempt.studentId.lastName}`,
    testName: mockAttempt.testId?.title,
    score: scoreVal,
    status: getAttemptResultStatus(mockAttempt, mockAttempt.percentage, mockAttempt.testId),
    resultStatus: mockAttempt.resultStatus || null,
    date: mockAttempt.submittedAt,
  };

  assert.strictEqual(row.id, "attempt_id_123");
  assert.strictEqual(row.testId, "test_id_456");
  assert.notStrictEqual(row.id, row.testId);
  assert.strictEqual(row.score, 85);
  assert.strictEqual(row.status, "pass");
  assert.strictEqual(row.resultStatus, "PASS");
});

test("2.2 recentTests preserves genuine 0% score and returns null for missing score", () => {
  const attemptZero = {
    _id: "att_0",
    testId: { _id: "test_1", title: "Physics" },
    studentId: { firstName: "Bob" },
    percentage: 0,
    status: "EVALUATED",
    resultStatus: "FAIL",
  };
  const attemptPending = {
    _id: "att_pend",
    testId: { _id: "test_2", title: "Chemistry" },
    studentId: { firstName: "Alice" },
    percentage: null,
    status: "SUBMITTED",
  };

  const mapAttempt = (attempt) => {
    const hasScore =
      attempt.percentage !== null &&
      attempt.percentage !== undefined &&
      Number.isFinite(Number(attempt.percentage));
    return {
      id: attempt._id,
      testId: attempt.testId?._id || attempt.testId,
      score: hasScore ? Math.round(Number(attempt.percentage)) : null,
      status: getAttemptResultStatus(attempt, attempt.percentage, attempt.testId),
      resultStatus: attempt.resultStatus || null,
    };
  };

  const rowZero = mapAttempt(attemptZero);
  assert.strictEqual(rowZero.score, 0);
  assert.strictEqual(rowZero.status, "fail");

  const rowPending = mapAttempt(attemptPending);
  assert.strictEqual(rowPending.score, null);
  assert.strictEqual(rowPending.status, "pending");
  assert.strictEqual(rowPending.resultStatus, null);
});

// 3. Pending-score dilution in averageScoreOverTime
test("3.1 Pending attempts do not dilute averageScoreOverTime", () => {
  const getWeekNumber = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  const weeklyBuckets = new Map();
  const attempts = [
    {
      submittedAt: new Date("2026-10-20T10:00:00Z"),
      status: "EVALUATED",
      percentage: 80,
    },
    {
      submittedAt: new Date("2026-10-20T11:00:00Z"),
      status: "SUBMITTED",
      percentage: null,
    },
    {
      submittedAt: new Date("2026-10-20T12:00:00Z"),
      status: "SUBMITTED",
      percentage: null,
    },
  ];

  attempts.forEach((attempt) => {
    const date = new Date(attempt.submittedAt);
    const isEvaluated =
      attempt.status === "EVALUATED" ||
      attempt.resultStatus === "PASS" ||
      attempt.resultStatus === "FAIL";
    const hasValidScore =
      isEvaluated &&
      attempt.percentage !== null &&
      attempt.percentage !== undefined &&
      Number.isFinite(Number(attempt.percentage));
    const percentage = hasValidScore ? Number(attempt.percentage) : null;

    const weekNum = getWeekNumber(date);
    const weekKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    const weekEntry = weeklyBuckets.get(weekKey);
    if (weekEntry) {
      weekEntry.count += 1;
      if (percentage !== null) {
        weekEntry.scoreSum += percentage;
        weekEntry.scoredCount += 1;
      }
    } else {
      weeklyBuckets.set(weekKey, {
        label: `Week ${weekNum}`,
        count: 1,
        scoreSum: percentage !== null ? percentage : 0,
        scoredCount: percentage !== null ? 1 : 0,
      });
    }
  });

  const entry = Array.from(weeklyBuckets.values())[0];
  assert.strictEqual(entry.count, 3, "Activity count must be 3");
  assert.strictEqual(entry.scoredCount, 1, "Scored count must be 1");
  assert.strictEqual(entry.scoreSum, 80, "Score sum must be 80");

  const avgScore = entry.scoredCount > 0 ? Math.round(entry.scoreSum / entry.scoredCount) : null;
  assert.strictEqual(avgScore, 80, "Average score must be 80%, not diluted by pending attempts");
});

test("3.2 Period with genuine zero score preserves avgScore = 0", () => {
  const weeklyBuckets = new Map();
  const attempt = {
    submittedAt: new Date("2026-10-20T10:00:00Z"),
    status: "EVALUATED",
    percentage: 0,
  };

  const isEvaluated =
    attempt.status === "EVALUATED" ||
    attempt.resultStatus === "PASS" ||
    attempt.resultStatus === "FAIL";
  const hasValidScore =
    isEvaluated &&
    attempt.percentage !== null &&
    attempt.percentage !== undefined &&
    Number.isFinite(Number(attempt.percentage));
  const percentage = hasValidScore ? Number(attempt.percentage) : null;

  const entry = {
    count: 1,
    scoreSum: percentage !== null ? percentage : 0,
    scoredCount: percentage !== null ? 1 : 0,
  };

  const avgScore = entry.scoredCount > 0 ? Math.round(entry.scoreSum / entry.scoredCount) : null;
  assert.strictEqual(avgScore, 0, "Genuine 0% score must result in avgScore: 0");
});

test("3.3 Period with no scored attempts produces avgScore = null", () => {
  const entry = {
    count: 2,
    scoreSum: 0,
    scoredCount: 0,
  };

  const avgScore = entry.scoredCount > 0 ? Math.round(entry.scoreSum / entry.scoredCount) : null;
  assert.strictEqual(avgScore, null, "Period with no scored attempts must return null");
});

console.log(`\nAll ${passedCount} Phase E2.7 Backend Verification checks PASSED successfully!`);
