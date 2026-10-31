import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import { connectDB } from "../../src/config/db.js";
import {
  getAdminDashboardData,
  getOrganizationDashboardData,
  getStudentDashboardData,
  buildEngagementMetrics,
} from "../../src/modules/analytics/dashboard/dashboard.service.js";
import TestAttempt from "../../src/models/testAttempt.model.js";
import Test from "../../src/models/test.model.js";
import User from "../../src/modules/auth/models/User.model.js";
import Organization from "../../src/models/organization.model.js";
import PlatformDailySummary from "../../src/models/platformDailySummary.model.js";
import StudentPerformanceSummary from "../../src/models/studentPerformanceSummary.model.js";

console.log("===================================================================");
console.log("=== PHASE E2.9.1 — PERFORMANCE BENCHMARKING & PROFILING ===");
console.log("===================================================================\n");

await connectDB();

const testStudentId = "6a58fcec24446ef390bf4cf5"; // Student with 87 attempts
const testOrgId = "6a7af213142ff44023fff19b"; // Tech Launch org with 15 students
const testOrgUserId = "6a7af213142ff44023fff19c";

// -------------------------------------------------------------
// 1. ENDPOINT RESPONSE TIMES (Median, P95, Min, Max) & PAYLOAD SIZES
// -------------------------------------------------------------
console.log("--- 1. Measuring Endpoint Response Times (5 runs each) ---");

async function benchmark(fn, label) {
  const times = [];
  let lastResult = null;
  // Warmup run
  await fn();
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    lastResult = await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const payloadStr = JSON.stringify(lastResult);
  const payloadBytes = Buffer.byteLength(payloadStr, "utf8");
  const payloadKb = (payloadBytes / 1024).toFixed(2);

  console.log(`\n[${label}]`);
  console.log(`  Runs: [${times.map(t => t.toFixed(1) + "ms").join(", ")}]`);
  console.log(`  Min: ${min.toFixed(1)}ms | Median: ${median.toFixed(1)}ms | P95: ${p95.toFixed(1)}ms | Max: ${max.toFixed(1)}ms`);
  console.log(`  Payload: ${payloadBytes} bytes (${payloadKb} KB)`);

  return { label, min, median, p95, max, payloadBytes, payloadKb, result: lastResult };
}

const adminProfile = await benchmark(() => getAdminDashboardData(), "Admin Dashboard");
const orgProfile = await benchmark(() => getOrganizationDashboardData(testOrgId, testOrgUserId), "Organization Dashboard");
const studentProfile = await benchmark(() => getStudentDashboardData(testStudentId), "Student Dashboard");

// -------------------------------------------------------------
// 2. QUERY STREAM BREAKDOWN FOR ADMIN DASHBOARD
// -------------------------------------------------------------
console.log("\n--- 2. Stream-by-Stream Breakdown for Admin Dashboard ---");

const now = new Date();
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
const endOfToday = new Date(startOfToday);
endOfToday.setDate(endOfToday.getDate() + 1);
const monthStart = new Date();
monthStart.setDate(1);
monthStart.setHours(0, 0, 0, 0);

const testFilter = { isDeleted: { $ne: 1 } };
const attemptFilter = { status: { $in: ["SUBMITTED", "EVALUATED"] } };
const studentFilter = { role: "STUDENT", isDeleted: { $ne: true } };

async function measureTime(fn) {
  const s = performance.now();
  const res = await fn();
  return { time: performance.now() - s, res };
}

// Stream 1
const s1 = await measureTime(async () => {
  return Promise.all([
    User.countDocuments(studentFilter),
    Organization.countDocuments(),
    Test.countDocuments({ ...testFilter, isPublished: true }),
    Test.countDocuments({ ...testFilter, isPublished: false }),
    Test.countDocuments(testFilter),
    User.countDocuments({ ...studentFilter, createdAt: { $gte: monthStart } }),
  ]);
});

// Stream 2
const s2 = await measureTime(async () => {
  return Promise.all([
    TestAttempt.countDocuments(attemptFilter),
  ]);
});

// Stream 3A: Recent 10
const s3A = await measureTime(async () => {
  return TestAttempt.find(attemptFilter)
    .select("status resultStatus percentage submittedAt updatedAt createdAt testId studentId")
    .populate("studentId", "firstName lastName email")
    .populate({ path: "testId", select: "title" })
    .sort({ submittedAt: -1 })
    .limit(10)
    .lean();
});

// Stream 3B: Distinct completed test IDs
const s3B = await measureTime(async () => {
  return TestAttempt.distinct("testId", attemptFilter);
});

// Stream 3C: Historical attempts (1 year)
const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
const s3C = await measureTime(async () => {
  return TestAttempt.find({ ...attemptFilter, submittedAt: { $gte: oneYearAgo } })
    .select("status resultStatus percentage submittedAt updatedAt createdAt testId")
    .sort({ submittedAt: -1 })
    .lean();
});

// Stream 3D: Historical test subjects
const s3D = await measureTime(async () => {
  const distinctTestIds = [...new Set(s3C.res.map(a => String(a.testId)).filter(Boolean))];
  return Test.find({ _id: { $in: distinctTestIds } })
    .select("subjectIds")
    .populate({ path: "subjectIds", select: "name" })
    .lean();
});

// JS Aggregation Time
const tJsStart = performance.now();
const testSubjectMap = new Map(s3D.res.map(t => [String(t._id), t.subjectIds || []]));
const metrics = buildEngagementMetrics(s3C.res, testSubjectMap);
const jsTime = performance.now() - tJsStart;

console.log(`  Stream 1 (Counts & KPIs):               ${s1.time.toFixed(1)}ms`);
console.log(`  Stream 2 (Assignment / Attempt counts): ${s2.time.toFixed(1)}ms`);
console.log(`  Stream 3A (Recent 10 attempts):         ${s3A.time.toFixed(1)}ms (${s3A.res.length} docs)`);
console.log(`  Stream 3B (Distinct completed testIds):  ${s3B.time.toFixed(1)}ms (${s3B.res.length} distinct tests)`);
console.log(`  Stream 3C (Historical attempts fetch):  ${s3C.time.toFixed(1)}ms (${s3C.res.length} docs)`);
console.log(`  Stream 3D (Historical test subjects):   ${s3D.time.toFixed(1)}ms (${s3D.res.length} test docs populated)`);
console.log(`  Application Processing (JS Map/Set):    ${jsTime.toFixed(1)}ms`);

// -------------------------------------------------------------
// 3. INDEX EFFECTIVENESS & EXECUTION PLANS
// -------------------------------------------------------------
console.log("\n--- 3. Index Effectiveness & Execution Plans ---");

// TestAttempt submittedAt sort (Recent 10)
const planRecent = await TestAttempt.find(attemptFilter)
  .sort({ submittedAt: -1 })
  .limit(10)
  .explain("executionStats");

console.log("[Recent Attempts Query Plan]");
console.log(`  Stage: ${planRecent.queryPlanner.winningPlan.stage}`);
console.log(`  Docs Examined: ${planRecent.executionStats.totalDocsExamined} | Keys Examined: ${planRecent.executionStats.totalKeysExamined}`);
console.log(`  Execution Time: ${planRecent.executionStats.executionTimeMillis}ms`);

// TestAttempt Historical Range Query
const planHistorical = await TestAttempt.find({ ...attemptFilter, submittedAt: { $gte: oneYearAgo } })
  .select("status resultStatus percentage submittedAt updatedAt createdAt testId")
  .sort({ submittedAt: -1 })
  .explain("executionStats");

console.log("\n[Historical Attempts Range Query Plan]");
console.log(`  Stage: ${planHistorical.queryPlanner.winningPlan.stage}`);
console.log(`  Docs Examined: ${planHistorical.executionStats.totalDocsExamined} | Keys Examined: ${planHistorical.executionStats.totalKeysExamined}`);
console.log(`  Execution Time: ${planHistorical.executionStats.executionTimeMillis}ms`);

// Distinct testId Query
console.log("\n[Distinct Completed TestId Index Check]");
const testAttemptIndexes = await TestAttempt.collection.getIndexes();
console.log("  TestAttempt index keys:", Object.keys(testAttemptIndexes));

// -------------------------------------------------------------
// 4. STUDENT DASHBOARD STREAM BREAKDOWN & PAYLOAD INSPECTION
// -------------------------------------------------------------
console.log("\n--- 4. Student Dashboard Breakdown & Payload Inspection ---");
console.log(`  Student Data Top Keys: ${Object.keys(studentProfile.result).join(", ")}`);
console.log(`  Total tests array length: ${studentProfile.result.tests?.length}`);
console.log(`  AllTests array length: ${studentProfile.result.allTests?.length}`);

// Compare size of tests vs allTests
const testsSize = Buffer.byteLength(JSON.stringify(studentProfile.result.tests), "utf8");
const allTestsSize = Buffer.byteLength(JSON.stringify(studentProfile.result.allTests), "utf8");
console.log(`  Size of tests: ${(testsSize / 1024).toFixed(2)} KB`);
console.log(`  Size of allTests: ${(allTestsSize / 1024).toFixed(2)} KB`);

// -------------------------------------------------------------
// 5. SUMMARY COLLECTION UTILIZATION (PlatformDailySummary & StudentPerformanceSummary)
// -------------------------------------------------------------
console.log("\n--- 5. Summary Collection Utilization ---");

const platformDailyCount = await PlatformDailySummary.countDocuments();
const studentSummaryCount = await StudentPerformanceSummary.countDocuments();
console.log(`  PlatformDailySummary total records: ${platformDailyCount}`);
console.log(`  StudentPerformanceSummary total records: ${studentSummaryCount}`);

const samplePlatformSummaries = await PlatformDailySummary.find().sort({ dateKey: -1 }).limit(5).lean();
console.log(`  Latest 5 PlatformDailySummary dateKeys:`, samplePlatformSummaries.map(s => s.dateKey));

// Check if PlatformDailySummary covers all 343 attempts
const platformTotalTests = samplePlatformSummaries.reduce((sum, s) => sum + (s.totalTestsCompleted || 0), 0);
console.log(`  Sample 5 PlatformDailySummary completed tests sum: ${platformTotalTests}`);

// Check student summary for test student
const studentSummary = await StudentPerformanceSummary.findOne({ studentId: testStudentId }).lean();
console.log(`  Student ${testStudentId} StudentPerformanceSummary:`, studentSummary ? {
  totalTestsAttempted: studentSummary.totalTestsAttempted,
  scoredAttemptCount: studentSummary.scoredAttemptCount,
  totalPercentageSum: studentSummary.totalPercentageSum,
  accuracy: studentSummary.accuracy
} : "None");

process.exit(0);
