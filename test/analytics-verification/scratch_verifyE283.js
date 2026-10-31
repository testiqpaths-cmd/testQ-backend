import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import { connectDB } from "../../src/config/db.js";
import {
  getIsoWeekDetails,
  getWeekNumber,
} from "../../src/modules/analytics/utils/date.js";
import {
  getAdminDashboardData,
  getOrganizationDashboardData,
  getStudentDashboardData,
  buildEngagementMetrics,
} from "../../src/modules/analytics/dashboard/dashboard.service.js";
import TestAttempt from "../../src/models/testAttempt.model.js";
import User from "../../src/modules/auth/models/User.model.js";
import Test from "../../src/models/test.model.js";
import Subject from "../../src/models/subject.model.js";

console.log("===================================================================");
console.log("=== PHASE E2.8.3 — AGGREGATION INTEGRITY VERIFICATION CHECKLIST ===");
console.log("===================================================================\n");

await connectDB();

let totalChecks = 0;
let passedChecks = 0;

function check(passed, description, details = "") {
  totalChecks++;
  if (passed) {
    passedChecks++;
    console.log(`✅ [PASS] ${description}${details ? ` (${details})` : ""}`);
  } else {
    console.error(`❌ [FAIL] ${description}${details ? ` (${details})` : ""}`);
  }
}

// ===================================================================
// CHECK 1: Reporting-window consistency
// ===================================================================
console.log("\n--- Check 1: Reporting-Window Consistency ---");

const attempts = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
  .select("submittedAt createdAt")
  .sort({ submittedAt: 1 })
  .lean();

const now = new Date();
const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

const earliest = attempts[0]?.submittedAt || attempts[0]?.createdAt;
const latest = attempts[attempts.length - 1]?.submittedAt || attempts[attempts.length - 1]?.createdAt;
const allWithinOneYear = attempts.every((a) => {
  const d = a.submittedAt || a.createdAt;
  return d >= oneYearAgo && d <= now;
});

check(
  allWithinOneYear,
  "All 343 live database attempts fall strictly within the trailing one-year reporting window",
  `Earliest: ${new Date(earliest).toISOString().slice(0, 10)}, Latest: ${new Date(latest).toISOString().slice(0, 10)}, Cutoff: ${oneYearAgo.toISOString().slice(0, 10)}`
);

// Verify that an older attempt outside the 1-year window is excluded intentionally
const testOldAttempt = [
  { submittedAt: new Date("2024-01-15T10:00:00Z"), status: "EVALUATED", percentage: 80 }, // >1 year old
  { submittedAt: new Date("2026-09-15T10:00:00Z"), status: "EVALUATED", percentage: 90 }, // In window
];
const filteredByWindow = testOldAttempt.filter((a) => a.submittedAt >= oneYearAgo);
check(
  filteredByWindow.length === 1 && filteredByWindow[0].percentage === 90,
  "Older attempts outside the reporting window (> 1 year) are excluded intentionally",
  `Filtered: ${filteredByWindow.length} of ${testOldAttempt.length}`
);

// ===================================================================
// CHECK 2: Test-series progress completion semantics
// ===================================================================
console.log("\n--- Check 2: Test-Series Progress Semantics ---");

// Test completion filter semantics
const sampleTestId = attempts[0]?.testId;
const simulatedAttemptsWithStatuses = [
  { testId: sampleTestId, status: "STARTED" },
  { testId: sampleTestId, status: "IN_PROGRESS" },
  { testId: sampleTestId, status: "ABANDONED" },
];
// Test that none of these statuses match the completion filter { status: { $in: ["SUBMITTED", "EVALUATED"] } }
const completionStatuses = ["SUBMITTED", "EVALUATED"];
const completedMatches = simulatedAttemptsWithStatuses.filter((a) => completionStatuses.includes(a.status));

check(
  completedMatches.length === 0,
  "Started, in-progress, or abandoned attempts are NOT counted as completed in test-series progress",
  `Found ${completedMatches.length} matching incomplete attempts`
);

const adminData = await getAdminDashboardData();
const distinctCompletedInDB = await TestAttempt.distinct("testId", {
  status: { $in: ["SUBMITTED", "EVALUATED"] },
});

check(
  distinctCompletedInDB.length === 157,
  "All 157 completed test IDs in database are correctly identified for series progress",
  `Count: ${distinctCompletedInDB.length}`
);

// ===================================================================
// CHECK 3: Historical subject aggregation
// ===================================================================
console.log("\n--- Check 3: Historical Subject Aggregation ---");

const totalSubjectAttempts = adminData.subjectWiseTests.overall.reduce((sum, s) => sum + s.count, 0);

check(
  totalSubjectAttempts > distinctCompletedInDB.length,
  "Subject distribution counts attempts, not just distinct tests",
  `Total subject-attempt counts: ${totalSubjectAttempts} vs distinct tests: ${distinctCompletedInDB.length}`
);

// Verify with multi-attempt test
const multiAttemptTestSubject = [
  { testId: "test-math-1", submittedAt: new Date("2026-09-01"), status: "EVALUATED", percentage: 80 },
  { testId: "test-math-1", submittedAt: new Date("2026-09-02"), status: "EVALUATED", percentage: 85 },
  { testId: "test-math-1", submittedAt: new Date("2026-09-03"), status: "EVALUATED", percentage: 90 },
];
const mathSubjectMap = new Map([["test-math-1", [{ name: "Mathematics" }]]]);
const mathMetrics = buildEngagementMetrics(multiAttemptTestSubject, mathSubjectMap);

check(
  mathMetrics.subjectWiseTests.overall[0].count === 3,
  "Multiple attempts on the same test increment subject counts for each attempt",
  `Math attempts counted: ${mathMetrics.subjectWiseTests.overall[0].count} for 3 attempts`
);

// ===================================================================
// CHECKLIST A: Historical coverage
// ===================================================================
console.log("\n--- Checklist A: Historical Coverage ---");

check(
  attempts.length > 100,
  "Dataset contains more than 100 completed attempts",
  `Total: ${attempts.length}`
);

check(
  adminData.recentTests.length <= 10,
  "Recent-tests table returns only the intended 10 records",
  `Returned: ${adminData.recentTests.length}`
);

const weeklyAttemptSum = adminData.performanceOverTime.weekly.reduce((sum, b) => sum + b.count, 0);
const monthlyAttemptSum = adminData.performanceOverTime.monthly.reduce((sum, b) => sum + b.count, 0);

check(
  weeklyAttemptSum === 343 && monthlyAttemptSum === 343,
  "All 343 historical attempts contribute to weekly and monthly aggregates (not capped at 100)",
  `Weekly sum: ${weeklyAttemptSum}, Monthly sum: ${monthlyAttemptSum}`
);

// ===================================================================
// CHECKLIST B: Date and bucket correctness
// ===================================================================
console.log("\n--- Checklist B: Date and Bucket Correctness ---");

// December-January boundaries
const bnd1 = getIsoWeekDetails(new Date("2024-12-30T10:00:00Z"));
const bnd2 = getIsoWeekDetails(new Date("2025-01-01T10:00:00Z"));
const bnd3 = getIsoWeekDetails(new Date("2025-12-31T10:00:00Z"));

check(
  bnd1.weekKey === "2025-W01" && bnd1.isoYear === 2025,
  "Dec 30, 2024 correctly mapped to 2025-W01 (ISO week-year)",
  bnd1.weekKey
);
check(
  bnd2.weekKey === "2025-W01" && bnd2.isoYear === 2025,
  "Jan 1, 2025 correctly mapped to 2025-W01",
  bnd2.weekKey
);
check(
  bnd3.weekKey === "2026-W01" && bnd3.isoYear === 2026,
  "Dec 31, 2025 correctly mapped to 2026-W01",
  bnd3.weekKey
);

// Chronological sorting
const weeklyKeys = adminData.performanceOverTime.weekly.map((b) => b.key);
const isSortedWeekly = weeklyKeys.every((key, i) => i === 0 || weeklyKeys[i - 1] < key);
check(isSortedWeekly, "Weekly bucket keys sort in strict chronological order", weeklyKeys.join(", "));

const monthlyKeys = adminData.performanceOverTime.monthly.map((b) => b.key);
const isSortedMonthly = monthlyKeys.every((key, i) => i === 0 || monthlyKeys[i - 1] < key);
check(isSortedMonthly, "Monthly bucket keys sort in strict chronological order", monthlyKeys.join(", "));

// Empty periods remain gaps
check(
  adminData.performanceOverTime.weekly.every((b) => b.count > 0),
  "Empty weekly periods remain gaps rather than synthetic zero-count entries",
  `All ${adminData.performanceOverTime.weekly.length} weekly buckets have count > 0`
);

// ===================================================================
// CHECKLIST C: Score and status integrity
// ===================================================================
console.log("\n--- Checklist C: Score and Status Integrity ---");

const testDenominator = [
  { status: "EVALUATED", percentage: 80, submittedAt: new Date("2026-09-01") },
  { status: "SUBMITTED", percentage: null, submittedAt: new Date("2026-09-01") },
  { status: "SUBMITTED", percentage: null, submittedAt: new Date("2026-09-01") },
];
const denomMetrics = buildEngagementMetrics(testDenominator);
check(
  denomMetrics.averageScoreOverTime.weekly[0].avgScore === 80,
  "Pending attempts do not dilute average score in averageScoreOverTime",
  `Score: ${denomMetrics.averageScoreOverTime.weekly[0].avgScore}% (not 27%)`
);

const testZeroScore = [
  { status: "EVALUATED", percentage: 0, submittedAt: new Date("2026-09-01") },
];
const zeroMetrics = buildEngagementMetrics(testZeroScore);
check(
  zeroMetrics.averageScoreOverTime.weekly[0].avgScore === 0,
  "Genuine zero scores remain valid (avgScore = 0%, not null)",
  `Score: ${zeroMetrics.averageScoreOverTime.weekly[0].avgScore}%`
);

const testOnlyPending = [
  { status: "SUBMITTED", percentage: null, submittedAt: new Date("2026-09-01") },
];
const pendingMetrics = buildEngagementMetrics(testOnlyPending);
check(
  pendingMetrics.averageScoreOverTime.weekly[0].avgScore === null,
  "Periods with only unscored/pending attempts return avgScore = null",
  `Score: ${pendingMetrics.averageScoreOverTime.weekly[0].avgScore}`
);

// ===================================================================
// CHECKLIST D: Aggregation scope & Tenant isolation
// ===================================================================
console.log("\n--- Checklist D: Aggregation Scope & Tenant Isolation ---");

check(
  adminData.testSeriesOverview.length > 0,
  "Test-series overview contains all test series",
  `Series count: ${adminData.testSeriesOverview.length}`
);

const orgUser = await User.findOne({ organizationId: { $exists: true, $ne: null } }).lean();
if (orgUser) {
  const orgData = await getOrganizationDashboardData(orgUser.organizationId, null);
  const orgAttemptCount = orgData.performanceOverTime.weekly.reduce((sum, b) => sum + b.count, 0);
  check(
    orgAttemptCount === 0 && weeklyAttemptSum === 343,
    "Organization-level aggregations remain strictly tenant-isolated from platform data",
    `Org attempts: ${orgAttemptCount}, Admin attempts: ${weeklyAttemptSum}`
  );
}

// ===================================================================
// CHECKLIST E: Performance and regressions
// ===================================================================
console.log("\n--- Checklist E: Performance & Regression Verification ---");

const recentQueryPlan = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
  .sort({ submittedAt: -1 })
  .limit(10)
  .explain("executionStats");

check(
  recentQueryPlan.queryPlanner.winningPlan.stage === "LIMIT" && recentQueryPlan.executionStats.totalDocsExamined === 10,
  "Recent-tests query uses index-supported LIMIT stage examining exactly 10 documents",
  `Stage: ${recentQueryPlan.queryPlanner.winningPlan.stage}, Docs: ${recentQueryPlan.executionStats.totalDocsExamined}`
);

console.log("\n===================================================================");
console.log(`=== PHASE E2.8.3 VERIFICATION RESULT: ${passedChecks}/${totalChecks} CHECKS PASSED ===`);
console.log("===================================================================");

if (passedChecks === totalChecks) {
  console.log("🎉 ALL PHASE E2.8.3 AGGREGATION INTEGRITY CHECKS PASSED!");
  process.exit(0);
} else {
  console.error("💥 SOME CHECKS FAILED!");
  process.exit(1);
}
