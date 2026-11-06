import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import Test from "../src/models/test.model.js";
import Topic from "../src/models/topic.model.js";
import Subject from "../src/models/subject.model.js";
import Question from "../src/models/question.model.js";
import User from "../src/models/user.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";
import { evaluateObjectiveForAttempt } from "../src/modules/test-attempts/services/evaluateObjectiveAttempts.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

function deepCompare(a, b, path = "") {
  if (a === b) return true;
  if (a == null || b == null) {
    if (a !== b) {
      console.error(`Mismatch at ${path}: ${a} !== ${b}`);
      return false;
    }
    return true;
  }
  if (a instanceof Date || b instanceof Date) {
    const aTime = new Date(a).getTime();
    const bTime = new Date(b).getTime();
    if (aTime !== bTime) {
      console.error(`Date mismatch at ${path}: ${a} vs ${b}`);
      return false;
    }
    return true;
  }
  if (typeof a !== typeof b) {
    console.error(`Type mismatch at ${path}: ${typeof a} vs ${typeof b}`);
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      console.error(`Array length mismatch at ${path}: ${a.length} vs ${b.length}`);
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepCompare(a[i], b[i], `${path}[${i}]`)) return false;
    }
    return true;
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a).filter((k) => a[k] !== undefined);
    const bKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    for (const key of aKeys) {
      if (!deepCompare(a[key], b[key], `${path}.${key}`)) return false;
    }
    for (const key of bKeys) {
      if (!(key in a)) {
        console.error(`Extra key in b at ${path}.${key}`);
        return false;
      }
    }
    return true;
  }
  if (String(a) !== String(b)) {
    console.error(`Value mismatch at ${path}: ${a} vs ${b}`);
    return false;
  }
  return true;
}

async function runVerification() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Phase 3 Parity & Performance Verification.\n");

  try {
    // 1. Find sample students with attempts
    const sampleAttempts = await TestAttempt.aggregate([
      { $match: { status: { $in: ["SUBMITTED", "EVALUATED"] } } },
      { $group: { _id: "$studentId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    if (sampleAttempts.length === 0) {
      console.error("No students with submitted/evaluated attempts found!");
      return;
    }

    console.log(`Found ${sampleAttempts.length} sample active students to verify.`);
    for (const s of sampleAttempts) {
      console.log(` - Student ${s._id}: ${s.count} attempts`);
    }

    // 2. Parity tests across all sample students
    console.log("\n=======================================================");
    console.log("CHECK 1: FULL DATA PARITY (Optimized vs Raw Fallback)");
    console.log("=======================================================");

    let totalParityChecks = 0;
    let passedParityChecks = 0;

    for (const sample of sampleAttempts) {
      const studentId = String(sample._id);

      process.env.USE_ANALYTICS_SNAPSHOTS = "true";
      process.env.USE_ANALYTICS_SUMMARIES = "true";
      const optResult = await getStudentDashboardData(studentId);

      process.env.USE_ANALYTICS_SNAPSHOTS = "false";
      process.env.USE_ANALYTICS_SUMMARIES = "true";
      const rawResult = await getStudentDashboardData(studentId);

      // Compare KPIs
      const kpisMatch =
        optResult.totalTestsAttempted === rawResult.totalTestsAttempted &&
        optResult.percentageAchieved === rawResult.percentageAchieved &&
        optResult.accuracy === rawResult.accuracy &&
        optResult.activeAssignedTestsCount === rawResult.activeAssignedTestsCount;

      // Compare subjectWiseTests
      const subjectsMatch = deepCompare(optResult.subjectWiseTests, rawResult.subjectWiseTests, "subjectWiseTests");

      // Compare recentTests (tests)
      const testsMatch = deepCompare(optResult.tests, rawResult.tests, "tests");

      // Compare allTests
      const allTestsMatch = deepCompare(optResult.allTests, rawResult.allTests, "allTests");

      // Compare timelines
      const timelinesMatch =
        deepCompare(optResult.percentageOverTime, rawResult.percentageOverTime, "percentageOverTime") &&
        deepCompare(optResult.performanceOverTime, rawResult.performanceOverTime, "performanceOverTime");

      const studentPassed = kpisMatch && subjectsMatch && testsMatch && allTestsMatch && timelinesMatch;
      totalParityChecks++;
      if (studentPassed) passedParityChecks++;

      console.log(`Student ${studentId} (${sample.count} attempts):`);
      console.log(`  KPIs match:          ${kpisMatch}`);
      console.log(`  Subject stats match: ${subjectsMatch}`);
      console.log(`  tests match:         ${testsMatch} (${optResult.tests.length} tests)`);
      console.log(`  allTests match:      ${allTestsMatch} (${optResult.allTests.length} tests)`);
      console.log(`  Timelines match:     ${timelinesMatch}`);
      console.log(`  Overall Status:      ${studentPassed ? "PASSED" : "FAILED"}\n`);
    }

    // 3. Test empty history
    console.log("=======================================================");
    console.log("CHECK 2: EMPTY HISTORY TEST");
    console.log("=======================================================");
    const fakeStudentId = new mongoose.Types.ObjectId();
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    const emptyResult = await getStudentDashboardData(fakeStudentId);
    const emptyPassed =
      emptyResult.totalTestsAttempted === 0 &&
      emptyResult.percentageAchieved === 0 &&
      emptyResult.accuracy === 0 &&
      emptyResult.tests.length === 0 &&
      emptyResult.allTests.length === 0;
    console.log(`Empty history returned expected zeros and empty arrays: ${emptyPassed}\n`);

    // 4. Test fallback on incomplete/missing snapshot
    console.log("=======================================================");
    console.log("CHECK 3: FALLBACK ON MISSING/INCOMPLETE SNAPSHOT");
    console.log("=======================================================");
    const testStudentId = String(sampleAttempts[0]._id);
    const anAttempt = await TestAttempt.findOne({
      studentId: new mongoose.Types.ObjectId(testStudentId),
      status: { $in: ["SUBMITTED", "EVALUATED"] },
    });

    const originalSnapshot = anAttempt.analyticsSnapshot;

    // Simulate corrupted/missing snapshot
    await TestAttempt.updateOne({ _id: anAttempt._id }, { $set: { analyticsSnapshot: null } });

    process.env.USE_ANALYTICS_SNAPSHOTS = "true"; // optimization is enabled, but attempt lacks snapshot
    const fallbackResult = await getStudentDashboardData(testStudentId);
    console.log(`Fallback triggered successfully: tests=${fallbackResult.tests.length}, allTests=${fallbackResult.allTests.length}`);
    const fallbackPassed = fallbackResult.allTests.length > 0 && fallbackResult.totalTestsAttempted > 0;
    console.log(`Fallback check passed: ${fallbackPassed}\n`);

    // Restore snapshot
    await TestAttempt.updateOne({ _id: anAttempt._id }, { $set: { analyticsSnapshot: originalSnapshot } });

    // 5. Re-evaluation test
    console.log("=======================================================");
    console.log("CHECK 4: RE-EVALUATION GENERATES & REFRESHES SNAPSHOT");
    console.log("=======================================================");
    const reEvalAttempt = await evaluateObjectiveForAttempt(anAttempt._id);
    const reEvalPassed =
      reEvalAttempt &&
      reEvalAttempt.analyticsSnapshot &&
      typeof reEvalAttempt.analyticsSnapshot.testName === "string" &&
      reEvalAttempt.analyticsSnapshot.difficultyBreakdown?.Medium !== undefined;
    console.log(`Re-evaluation snapshot refreshed successfully: ${reEvalPassed}`);
    console.log(`Snapshot testName: "${reEvalAttempt.analyticsSnapshot.testName}", subject: "${reEvalAttempt.analyticsSnapshot.subject}", topic: "${reEvalAttempt.analyticsSnapshot.topic}"\n`);

    // 6. Latency Benchmark
    console.log("=======================================================");
    console.log("CHECK 5: LATENCY BENCHMARK (Optimized vs Raw)");
    console.log("=======================================================");

    const benchmarkStudentId = String(sampleAttempts[0]._id);
    const WARMUP_RUNS = 2;
    const BENCHMARK_RUNS = 10;

    // Warmup
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    for (let i = 0; i < WARMUP_RUNS; i++) await getStudentDashboardData(benchmarkStudentId);
    process.env.USE_ANALYTICS_SNAPSHOTS = "false";
    for (let i = 0; i < WARMUP_RUNS; i++) await getStudentDashboardData(benchmarkStudentId);

    // Benchmark Optimized (Snapshots)
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    const optTimes = [];
    for (let i = 0; i < BENCHMARK_RUNS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(benchmarkStudentId);
      optTimes.push(performance.now() - t0);
    }

    // Benchmark Raw Fallback
    process.env.USE_ANALYTICS_SNAPSHOTS = "false";
    const rawTimes = [];
    for (let i = 0; i < BENCHMARK_RUNS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(benchmarkStudentId);
      rawTimes.push(performance.now() - t0);
    }

    const avgOpt = (optTimes.reduce((a, b) => a + b, 0) / optTimes.length).toFixed(2);
    const avgRaw = (rawTimes.reduce((a, b) => a + b, 0) / rawTimes.length).toFixed(2);
    const speedup = (avgRaw / avgOpt).toFixed(2);
    const latencyReduction = (((avgRaw - avgOpt) / avgRaw) * 100).toFixed(1);

    console.log(`Benchmark Student: ${benchmarkStudentId} (${sampleAttempts[0].count} attempts)`);
    console.log(`Runs: ${BENCHMARK_RUNS} iterations each`);
    console.log(`Optimized (with Snapshots) Latency: ${avgOpt} ms`);
    console.log(`Raw Fallback (Populate + Questions) Latency: ${avgRaw} ms`);
    console.log(`Speedup: ${speedup}x faster`);
    console.log(`Latency Reduction: ${latencyReduction}%\n`);

    console.log("=======================================================");
    console.log("FINAL PHASE 3 VERIFICATION SUMMARY");
    console.log("=======================================================");
    console.log(`Data Parity:           ${passedParityChecks}/${totalParityChecks} sample students passed`);
    console.log(`Empty History:         ${emptyPassed ? "PASSED" : "FAILED"}`);
    console.log(`Fallback Resiliency:   ${fallbackPassed ? "PASSED" : "FAILED"}`);
    console.log(`Re-evaluation Refresh: ${reEvalPassed ? "PASSED" : "FAILED"}`);
    console.log(`Performance:           ${avgRaw} ms -> ${avgOpt} ms (${latencyReduction}% lower latency)`);
    console.log("=======================================================\n");

  } catch (err) {
    console.error("Verification error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runVerification();
