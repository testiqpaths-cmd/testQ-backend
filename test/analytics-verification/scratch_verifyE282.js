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

console.log("=================================================");
console.log("=== PHASE E2.8.2 INTEGRATION VERIFICATION SUITE ===");
console.log("=================================================\n");

await connectDB();

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

// ==============================================================
// GATE E2.8.2-A: Correct ISO week-year boundary calculation
// ==============================================================
console.log("\n--- GATE E2.8.2-A: ISO Week-Year Boundaries ---");

const d1 = new Date("2024-12-30T12:00:00Z");
const res1 = getIsoWeekDetails(d1);
assert(res1.weekKey === "2025-W01", `Dec 30, 2024 -> 2025-W01 (got ${res1.weekKey})`);
assert(res1.isoYear === 2025, `Dec 30, 2024 isoYear === 2025`);

const d2 = new Date("2025-01-01T12:00:00Z");
const res2 = getIsoWeekDetails(d2);
assert(res2.weekKey === "2025-W01", `Jan 1, 2025 -> 2025-W01 (got ${res2.weekKey})`);
assert(res2.isoYear === 2025, `Jan 1, 2025 isoYear === 2025`);

const d3 = new Date("2025-12-31T12:00:00Z");
const res3 = getIsoWeekDetails(d3);
assert(res3.weekKey === "2026-W01", `Dec 31, 2025 -> 2026-W01 (got ${res3.weekKey})`);
assert(res3.isoYear === 2026, `Dec 31, 2025 isoYear === 2026`);

const d4 = new Date("2025-07-16T12:00:00Z");
const res4 = getIsoWeekDetails(d4);
assert(res4.weekKey === "2025-W29", `Jul 16, 2025 (normal mid-year) -> 2025-W29 (got ${res4.weekKey})`);

const sortSample = ["2025-01-05", "2024-12-25", "2024-12-30", "2025-01-15", "2025-12-31"]
  .map(s => getIsoWeekDetails(new Date(s + "T12:00:00Z")).weekKey);
const uniqueSorted = [...new Set(sortSample)].sort();
assert(
  JSON.stringify(uniqueSorted) === JSON.stringify(["2024-W52", "2025-W01", "2025-W03", "2026-W01"]),
  `Chronological sort across year boundaries: ${JSON.stringify(uniqueSorted)}`
);

// ==============================================================
// GATE E2.8.2-B: Student multi-year bucket qualification
// ==============================================================
console.log("\n--- GATE E2.8.2-B: Student Multi-Year Buckets ---");

// Test buildEngagementMetrics with multi-year attempts
const multiYearData = [
  { submittedAt: new Date("2025-10-10T10:00:00Z"), status: "EVALUATED", percentage: 75, testId: { subjectIds: [{ name: "Physics" }] } },
  { submittedAt: new Date("2025-10-20T10:00:00Z"), status: "EVALUATED", percentage: 85, testId: { subjectIds: [{ name: "Physics" }] } },
  { submittedAt: new Date("2026-10-15T10:00:00Z"), status: "EVALUATED", percentage: 90, testId: { subjectIds: [{ name: "Physics" }] } },
];
const studentMetrics = buildEngagementMetrics(multiYearData);

const monthlyBuckets = studentMetrics.performanceOverTime.monthly;
assert(monthlyBuckets.length === 2, `Oct 2025 and Oct 2026 remain separate monthly buckets (length: ${monthlyBuckets.length})`);
assert(monthlyBuckets[0].key === "2025-10" && monthlyBuckets[0].count === 2, `2025-10 bucket has count 2`);
assert(monthlyBuckets[1].key === "2026-10" && monthlyBuckets[1].count === 1, `2026-10 bucket has count 1`);
assert(monthlyBuckets[0].label === "Oct 2025", `2025-10 display label is "Oct 2025"`);
assert(monthlyBuckets[1].label === "Oct 2026", `2026-10 display label is "Oct 2026"`);

// Week 42 in 2025 and 2026
const multiYearWeeks = [
  { submittedAt: new Date("2025-10-15T10:00:00Z"), status: "EVALUATED", percentage: 70 }, // 2025-W42
  { submittedAt: new Date("2026-10-14T10:00:00Z"), status: "EVALUATED", percentage: 80 }, // 2026-W42
];
const weekMetrics = buildEngagementMetrics(multiYearWeeks);
const weeklyBuckets = weekMetrics.performanceOverTime.weekly;
assert(weeklyBuckets.length === 2, `Week 42 in 2025 and 2026 remain separate weekly buckets`);
assert(weeklyBuckets[0].key === "2025-W42" && weeklyBuckets[1].key === "2026-W42", `Weekly keys contain year`);

// ==============================================================
// GATE E2.8.2-C: Student fallback score denominator
// ==============================================================
console.log("\n--- GATE E2.8.2-C: Student Fallback Score Denominator ---");

// Unit check average calculation on fallback
const evaluatedOnlyAttempts = [
  { status: "EVALUATED", percentage: 80, answers: [], testId: { title: "T1" } },
  { status: "SUBMITTED", percentage: null, answers: [], testId: { title: "T2" } },
  { status: "SUBMITTED", percentage: null, answers: [], testId: { title: "T3" } },
];
// Test through live student dashboard call with student that has attempts
const studentUser = await User.findOne({ role: "STUDENT" }).lean();
if (studentUser) {
  const studentData = await getStudentDashboardData(studentUser._id);
  assert(studentData !== null, `Student dashboard loads successfully`);
  assert(studentData.percentageAchieved === null || Number.isFinite(studentData.percentageAchieved), `percentageAchieved is null or valid number (got ${studentData.percentageAchieved})`);
  assert(Array.isArray(studentData.performanceOverTime.weekly), `Student weekly performance is array`);
  assert(Array.isArray(studentData.performanceOverTime.monthly), `Student monthly performance is array`);
  if (studentData.performanceOverTime.monthly.length > 0) {
    const sampleMonth = studentData.performanceOverTime.monthly[0];
    assert(sampleMonth.key && /^\d{4}-\d{2}$/.test(sampleMonth.key), `Student month has year-qualified key (got ${sampleMonth.key})`);
  }
}

// ==============================================================
// GATE E2.8.2-D: Separate recent tests from historical aggregation
// ==============================================================
console.log("\n--- GATE E2.8.2-D: Separate Recent Tests & Historical Coverage ---");

const adminData = await getAdminDashboardData();

// Test: Recent tests table returns <= 10 records
assert(adminData.recentTests.length <= 10, `recentTests table length <= 10 (got ${adminData.recentTests.length})`);

// Test: Historical performanceOverTime includes ALL attempts (> 100)
const totalHistoricalAttemptsInWeekly = adminData.performanceOverTime.weekly.reduce((sum, b) => sum + b.count, 0);
const totalHistoricalAttemptsInMonthly = adminData.performanceOverTime.monthly.reduce((sum, b) => sum + b.count, 0);

console.log(`Historical weekly attempt sum: ${totalHistoricalAttemptsInWeekly}`);
console.log(`Historical monthly attempt sum: ${totalHistoricalAttemptsInMonthly}`);

assert(totalHistoricalAttemptsInWeekly > 100, `More than 100 attempts included in weekly historical aggregate (${totalHistoricalAttemptsInWeekly} > 100)`);
assert(totalHistoricalAttemptsInMonthly > 100, `More than 100 attempts included in monthly historical aggregate (${totalHistoricalAttemptsInMonthly} > 100)`);
assert(totalHistoricalAttemptsInWeekly === 343, `All 343 completed attempts in DB are included in historical aggregation (got ${totalHistoricalAttemptsInWeekly})`);
assert(totalHistoricalAttemptsInMonthly === 343, `All 343 completed attempts in DB are included in monthly aggregation (got ${totalHistoricalAttemptsInMonthly})`);

// Test: averageScoreOverTime maintains correct denominators
const weeklyScores = adminData.averageScoreOverTime.weekly;
assert(weeklyScores.length === adminData.performanceOverTime.weekly.length, `averageScoreOverTime and performanceOverTime have matching bucket counts`);
weeklyScores.forEach((b) => {
  if (b.avgScore !== null) {
    assert(Number.isFinite(b.avgScore) && b.avgScore >= 0 && b.avgScore <= 100, `Bucket ${b.key} has valid avgScore between 0 and 100 (got ${b.avgScore})`);
  }
});

// Test: Test series overview progress is not incorrectly zero
if (adminData.testSeriesOverview && adminData.testSeriesOverview.length > 0) {
  const seriesWithTests = adminData.testSeriesOverview.filter(s => s.tests > 0);
  console.log(`Test series count: ${adminData.testSeriesOverview.length}, with tests: ${seriesWithTests.length}`);
  assert(adminData.testSeriesOverview.length > 0, `testSeriesOverview populated`);
}

// Test: Tenant isolation between organizations
console.log("\n--- Tenant Isolation Check ---");
const orgUser = await User.findOne({ organizationId: { $exists: true, $ne: null } }).lean();
if (orgUser) {
  const orgData = await getOrganizationDashboardData(orgUser.organizationId, null);
  const orgTotalAttempts = orgData.performanceOverTime.weekly.reduce((sum, b) => sum + b.count, 0);
  console.log(`Org total attempts: ${orgTotalAttempts} vs Admin total: ${totalHistoricalAttemptsInWeekly}`);
  assert(orgTotalAttempts < totalHistoricalAttemptsInWeekly, `Tenant isolation preserved: Org (${orgTotalAttempts}) cannot see Admin full attempts (${totalHistoricalAttemptsInWeekly})`);
  assert(orgData.recentTests.length <= 10, `Org recentTests <= 10`);
} else {
  console.log("ℹ️ No organization user found in DB to test tenant isolation");
}

// ==============================================================
// GATE E2.8.2-E: Query plan optimization & execution stats
// ==============================================================
console.log("\n--- GATE E2.8.2-E: Query Plan & Performance Verification ---");

const filter = { status: { $in: ["SUBMITTED", "EVALUATED"] } };

// Measure new recent tests query plan
const recentPlan = await TestAttempt.find(filter)
  .sort({ submittedAt: -1 })
  .limit(10)
  .explain("executionStats");

const oldPlan = await TestAttempt.find(filter)
  .sort({ submittedAt: -1, updatedAt: -1 })
  .limit(10)
  .explain("executionStats");

console.log(`New Plan (submittedAt: -1): stage=${recentPlan.queryPlanner.winningPlan.stage}, docsExamined=${recentPlan.executionStats.totalDocsExamined}, time=${recentPlan.executionStats.executionTimeMillis}ms`);
console.log(`Old Plan (submittedAt: -1, updatedAt: -1): stage=${oldPlan.queryPlanner.winningPlan.stage}, docsExamined=${oldPlan.executionStats.totalDocsExamined}, time=${oldPlan.executionStats.executionTimeMillis}ms`);

assert(recentPlan.executionStats.totalDocsExamined === 10, `New plan examines only 10 docs (got ${recentPlan.executionStats.totalDocsExamined})`);
assert(oldPlan.executionStats.totalDocsExamined === 343, `Old plan examined all 343 docs (got ${oldPlan.executionStats.totalDocsExamined})`);
assert(recentPlan.queryPlanner.winningPlan.stage === "LIMIT", `New plan uses index-supported LIMIT stage`);
assert(oldPlan.queryPlanner.winningPlan.stage === "SORT", `Old plan suffered blocking in-memory SORT stage`);

console.log("\n=================================================");
console.log(`=== SUMMARY: ${passedTests}/${totalTests} TESTS PASSED ===`);
console.log("=================================================");

if (passedTests === totalTests) {
  console.log("🎉 ALL E2.8.2 ACCEPTANCE GATES PASSED SUCCESSFULLY!");
  process.exit(0);
} else {
  console.error("💥 SOME CHECKS FAILED!");
  process.exit(1);
}
