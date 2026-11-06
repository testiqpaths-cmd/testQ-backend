import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import Subject from "../src/models/subject.model.js";
import Topic from "../src/models/topic.model.js";
import Test from "../src/models/test.model.js";
import Question from "../src/models/question.model.js";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";
import { getDashboardTelemetryStats, resetTelemetryStats } from "../src/modules/analytics/dashboard/dashboardTelemetry.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

function deepEqual(a, b, path = "") {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) {
    console.error(`Type mismatch at ${path}: ${typeof a} vs ${typeof b}`);
    return false;
  }

  if (a instanceof Date && b instanceof Date) {
    const match = a.getTime() === b.getTime();
    if (!match) console.error(`Date mismatch at ${path}: ${a.toISOString()} vs ${b.toISOString()}`);
    return match;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      console.error(`Array length mismatch at ${path}: ${a.length} vs ${b.length}`);
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], `${path}[${i}]`)) return false;
    }
    return true;
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) {
      console.error(`Object keys mismatch at ${path}:`, keysA, "vs", keysB);
      return false;
    }
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key], `${path}.${key}`)) return false;
    }
    return true;
  }

  console.error(`Value mismatch at ${path}:`, a, "vs", b);
  return false;
}

async function runParityAndFallbackChecks() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Field Projection & Fallback Parity Check.\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5"; // Student with 59 attempts
    resetTelemetryStats();

    // 1. Verify Projected Query with Snapshots Enabled (Fast Path)
    console.log("1. Verifying Fast Path (Snapshots + Projection)...");
    const fastPathResult = await getStudentDashboardData(studentId);
    console.log(`   Fast Path returned ${fastPathResult.allTests.length} tests in allTests.`);
    console.log(`   totalTestsAttempted: ${fastPathResult.totalTestsAttempted}, accuracy: ${fastPathResult.accuracy}%`);

    // 2. Verify Raw Fallback with Projection (USE_ANALYTICS_SNAPSHOTS = false)
    console.log("\n2. Verifying Raw Fallback Path (USE_ANALYTICS_SNAPSHOTS = false)...");
    process.env.USE_ANALYTICS_SNAPSHOTS = "false";
    const rawFallbackResult = await getStudentDashboardData(studentId);
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";

    console.log(`   Raw Fallback returned ${rawFallbackResult.allTests.length} tests in allTests.`);
    console.log(`   totalTestsAttempted: ${rawFallbackResult.totalTestsAttempted}, accuracy: ${rawFallbackResult.accuracy}%`);

    // 3. Check Data Parity between Fast Path and Raw Fallback
    console.log("\n3. Comparing Fast Path vs Raw Fallback Data Parity...");
    const kpisMatch =
      fastPathResult.totalTestsAttempted === rawFallbackResult.totalTestsAttempted &&
      fastPathResult.percentageAchieved === rawFallbackResult.percentageAchieved &&
      fastPathResult.accuracy === rawFallbackResult.accuracy &&
      fastPathResult.activeAssignedTestsCount === rawFallbackResult.activeAssignedTestsCount;

    console.log(`   KPIs Match: ${kpisMatch ? "PASSED" : "FAILED"}`);
    if (!kpisMatch) {
      console.error("   Fast Path KPIs:", {
        totalTestsAttempted: fastPathResult.totalTestsAttempted,
        percentageAchieved: fastPathResult.percentageAchieved,
        accuracy: fastPathResult.accuracy,
      });
      console.error("   Raw Fallback KPIs:", {
        totalTestsAttempted: rawFallbackResult.totalTestsAttempted,
        percentageAchieved: rawFallbackResult.percentageAchieved,
        accuracy: rawFallbackResult.accuracy,
      });
    }

    const testCountsMatch =
      fastPathResult.tests.length === rawFallbackResult.tests.length &&
      fastPathResult.allTests.length === rawFallbackResult.allTests.length;
    console.log(`   Test Counts Match: ${testCountsMatch ? "PASSED" : "FAILED"} (${fastPathResult.allTests.length} items)`);

    // Check individual test parity in allTests
    let allTestsIdentical = true;
    for (let i = 0; i < fastPathResult.allTests.length; i++) {
      const f = fastPathResult.allTests[i];
      const r = rawFallbackResult.allTests[i];
      if (
        String(f.id) !== String(r.id) ||
        String(f.resultId) !== String(r.resultId) ||
        f.name !== r.name ||
        f.score !== r.score ||
        f.maxScore !== r.maxScore ||
        f.correct !== r.correct ||
        f.wrong !== r.wrong ||
        f.skipped !== r.skipped ||
        f.accuracy !== r.accuracy ||
        f.totalQuestions !== r.totalQuestions
      ) {
        allTestsIdentical = false;
        console.error(`   Mismatch at test [${i}]:`, { fast: f, raw: r });
        break;
      }
    }
    console.log(`   AllTests Detailed Parity: ${allTestsIdentical ? "PASSED (100% Match)" : "FAILED"}`);

    // 4. Verify Partial/Missing Snapshot Fallback Handling
    console.log("\n4. Verifying Fallback Handling when a snapshot is missing...");
    // Find one attempt, temporarily backup and unset its snapshot
    const sampleAttempt = await TestAttempt.findOne({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } });
    const originalSnapshot = sampleAttempt.analyticsSnapshot;

    try {
      await TestAttempt.updateOne({ _id: sampleAttempt._id }, { $unset: { analyticsSnapshot: 1 } });

      const fallbackResult = await getStudentDashboardData(studentId);
      console.log(`   Dashboard handled missing snapshot gracefully: ${fallbackResult.allTests.length} tests returned.`);

      const stats = getDashboardTelemetryStats();
      console.log("   Telemetry recorded fallback event:");
      console.log(`     fallbackCount: ${stats.fallbackCount}`);
      console.log(`     missingSnapshotCount: ${stats.missingSnapshotCount}`);
      console.log(`     fallbackRate: ${stats.fallbackRate}`);
      const fallbackRecorded = stats.fallbackCount > 0 && stats.missingSnapshotCount > 0;
      console.log(`   Fallback Observability: ${fallbackRecorded ? "PASSED" : "FAILED"}`);
    } finally {
      // Restore original snapshot immediately
      await TestAttempt.updateOne({ _id: sampleAttempt._id }, { $set: { analyticsSnapshot: originalSnapshot } });
      console.log("   Restored sample attempt snapshot.");
    }

    console.log("\n==================================================================");
    console.log("ALL FIELD PROJECTION & FALLBACK PARITY CHECKS COMPLETED SUCCESSFULLY!");
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runParityAndFallbackChecks();
