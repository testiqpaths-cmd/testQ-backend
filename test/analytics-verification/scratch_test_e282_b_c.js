import { getIsoWeekDetails } from "../../src/modules/analytics/utils/date.js";

console.log("=== Running Step E2.8.2-B & E2.8.2-C Verification Tests ===");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

// -------------------------------------------------------------
// STEP E2.8.2-B: Multi-year student bucket collision tests
// -------------------------------------------------------------

function buildStudentTimelineBuckets(attempts) {
  const weeklyBuckets = new Map();
  const monthlyBuckets = new Map();

  attempts.forEach((attempt) => {
    const date = new Date(attempt.submittedAt);
    const { weekKey, weekNum, label: weekLabel } = getIsoWeekDetails(date);
    const monthNum = String(date.getMonth() + 1).padStart(2, "0");
    const monthKey = `${date.getFullYear()}-${monthNum}`;
    const monthLabel = date.toLocaleString("en-US", { month: "short", year: "numeric" });

    const weekEntry = weeklyBuckets.get(weekKey);
    if (weekEntry) {
      weekEntry.count += 1;
    } else {
      weeklyBuckets.set(weekKey, {
        key: weekKey,
        label: weekLabel,
        count: 1,
      });
    }

    const monthEntry = monthlyBuckets.get(monthKey);
    if (monthEntry) {
      monthEntry.count += 1;
    } else {
      monthlyBuckets.set(monthKey, {
        key: monthKey,
        label: monthLabel,
        count: 1,
      });
    }
  });

  const weekly = Array.from(weeklyBuckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => ({ key: entry.key, label: entry.label, count: entry.count }));

  const monthly = Array.from(monthlyBuckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => ({ key: entry.key, label: entry.label, count: entry.count }));

  return { weekly, monthly };
}

// Test B1: October 2025 and October 2026 remain separate
const multiYearAttempts = [
  { submittedAt: new Date("2025-10-15T10:00:00Z") },
  { submittedAt: new Date("2025-10-20T10:00:00Z") },
  { submittedAt: new Date("2026-10-10T10:00:00Z") },
];

const { monthly: multiYearMonthly, weekly: multiYearWeekly } = buildStudentTimelineBuckets(multiYearAttempts);

assert(multiYearMonthly.length === 2, `Oct 2025 and Oct 2026 produce 2 separate monthly buckets (got ${multiYearMonthly.length})`);
assert(multiYearMonthly[0].key === "2025-10" && multiYearMonthly[0].count === 2, `Oct 2025 has key 2025-10 and count 2`);
assert(multiYearMonthly[1].key === "2026-10" && multiYearMonthly[1].count === 1, `Oct 2026 has key 2026-10 and count 1`);
assert(multiYearMonthly[0].label === "Oct 2025", `Oct 2025 display label is "Oct 2025"`);
assert(multiYearMonthly[1].label === "Oct 2026", `Oct 2026 display label is "Oct 2026"`);

// Test B2: Same week number in different years remains separate
const multiYearWeekAttempts = [
  { submittedAt: new Date("2025-10-15T10:00:00Z") }, // Week 42 in 2025
  { submittedAt: new Date("2026-10-14T10:00:00Z") }, // Week 42 in 2026
];
const { weekly: weekRes } = buildStudentTimelineBuckets(multiYearWeekAttempts);
assert(weekRes.length === 2, `Week 42 in 2025 and 2026 produce 2 separate weekly buckets`);
assert(weekRes[0].key === "2025-W42" && weekRes[0].count === 1, `2025-W42 bucket separated`);
assert(weekRes[1].key === "2026-W42" && weekRes[1].count === 1, `2026-W42 bucket separated`);

// Test B3: Chronological sorting
assert(multiYearMonthly[0].key < multiYearMonthly[1].key, `Monthly buckets sorted chronologically`);
assert(weekRes[0].key < weekRes[1].key, `Weekly buckets sorted chronologically`);

// -------------------------------------------------------------
// STEP E2.8.2-C: Student fallback score denominator tests
// -------------------------------------------------------------

function computeFallbackScore(attempts, summary = null) {
  let rawScoredPercentageSum = 0;
  let rawScoredAttemptCount = 0;

  attempts.forEach((attempt) => {
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

    if (hasValidScore) {
      rawScoredPercentageSum += percentage;
      rawScoredAttemptCount += 1;
    }
  });

  let percentageAchieved = null;
  if (summary && summary.totalTestsAttempted > 0 && summary.scoredAttemptCount > 0) {
    percentageAchieved = Math.round(summary.totalPercentageSum / summary.scoredAttemptCount);
  } else if (rawScoredAttemptCount > 0) {
    percentageAchieved = Math.round(rawScoredPercentageSum / rawScoredAttemptCount);
  } else {
    percentageAchieved = null;
  }

  return { percentageAchieved, rawScoredAttemptCount, rawScoredPercentageSum };
}

// Test C1: Evaluated (80%), Pending (null), Pending (null) -> 80%, not 26.67%
const mixAttempts = [
  { status: "EVALUATED", percentage: 80 },
  { status: "SUBMITTED", percentage: null },
  { status: "SUBMITTED", percentage: null },
];
const resC1 = computeFallbackScore(mixAttempts);
assert(resC1.percentageAchieved === 80, `Average score with 1 evaluated (80%) and 2 pending is 80% (got ${resC1.percentageAchieved}%)`);
assert(resC1.rawScoredAttemptCount === 1, `Scored attempt count is 1`);

// Test C2: Genuine zero score preserved
const zeroAttempts = [
  { status: "EVALUATED", percentage: 0 },
];
const resC2 = computeFallbackScore(zeroAttempts);
assert(resC2.percentageAchieved === 0, `Evaluated 0% score preserves genuine 0% average (got ${resC2.percentageAchieved}%)`);
assert(resC2.rawScoredAttemptCount === 1, `Scored attempt count is 1 for genuine 0%`);

// Test C3: No valid scored attempts (e.g. only pending attempts) -> null
const pendingOnlyAttempts = [
  { status: "SUBMITTED", percentage: null },
  { status: "SUBMITTED", percentage: null },
];
const resC3 = computeFallbackScore(pendingOnlyAttempts);
assert(resC3.percentageAchieved === null, `Pending-only attempts return null average score (got ${resC3.percentageAchieved})`);

// Test C4: Empty attempts list -> null
const emptyAttempts = [];
const resC4 = computeFallbackScore(emptyAttempts);
assert(resC4.percentageAchieved === null, `Empty attempts return null average score (got ${resC4.percentageAchieved})`);

console.log(`\nResult: ${passed}/${total} tests passed.`);
if (passed === total) {
  console.log("🎉 Gates E2.8.2-B & E2.8.2-C PASSED!");
  process.exit(0);
} else {
  console.error("💥 Gates E2.8.2-B & E2.8.2-C FAILED!");
  process.exit(1);
}
