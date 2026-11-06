import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import Subject from "../src/models/subject.model.js";
import Topic from "../src/models/topic.model.js";
import Test from "../src/models/test.model.js";
import Question from "../src/models/question.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import {
  getStudentDashboardData,
  getAdminDashboardData,
  isAnalyticsSummariesEnabled,
  isSummaryEngagementTrendEnabled,
  isAnalyticsSnapshotsEnabled,
} from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

const combinations = [
  { summaries: true,  trends: true,  snapshots: true,  desc: "All Optimized (Phase 1-5 Default)" },
  { summaries: false, trends: true,  snapshots: true,  desc: "Summaries Rolled Back" },
  { summaries: true,  trends: false, snapshots: true,  desc: "Engagement Trends Rolled Back" },
  { summaries: true,  trends: true,  snapshots: false, desc: "Snapshots Rolled Back (Raw Question/Populate Fallback)" },
  { summaries: false, trends: false, snapshots: true,  desc: "Summaries + Trends Rolled Back" },
  { summaries: false, trends: true,  snapshots: false, desc: "Summaries + Snapshots Rolled Back" },
  { summaries: true,  trends: false, snapshots: false, desc: "Trends + Snapshots Rolled Back" },
  { summaries: false, trends: false, snapshots: false, desc: "FULL ROLLBACK (All Legacy Raw Queries)" },
];

async function runRollbackMatrixVerification() {
  await mongoose.connect(mongoUri);
  console.log("==================================================================");
  console.log("ROLLBACK MATRIX VERIFICATION ACROSS ALL 8 FEATURE FLAG COMBINATIONS");
  console.log("==================================================================\n");

  const studentId = "6a58fcec24446ef390bf4cf5"; // Student with 59 attempts
  const results = [];

  // Capture baseline from (true, true, true)
  process.env.USE_ANALYTICS_SUMMARIES = "true";
  process.env.USE_SUMMARY_ENGAGEMENT_TREND = "true";
  process.env.USE_ANALYTICS_SNAPSHOTS = "true";

  const baselineStudent = await getStudentDashboardData(studentId);
  const baselineAdmin = await getAdminDashboardData();

  console.log(`Baseline established:`);
  console.log(`- Student totalTestsAttempted: ${baselineStudent.totalTestsAttempted}, allTests length: ${baselineStudent.allTests.length}`);
  console.log(`- Admin quickStats: ${JSON.stringify(baselineAdmin.quickStats)}, engagementTrend periods: ${Object.keys(baselineAdmin.studentEngagementTrend).join(", ")}\n`);

  for (let i = 0; i < combinations.length; i++) {
    const c = combinations[i];
    process.env.USE_ANALYTICS_SUMMARIES = String(c.summaries);
    process.env.USE_SUMMARY_ENGAGEMENT_TREND = String(c.trends);
    process.env.USE_ANALYTICS_SNAPSHOTS = String(c.snapshots);

    // Verify dynamic getters reflect env state
    const flagsMatch =
      isAnalyticsSummariesEnabled() === c.summaries &&
      isSummaryEngagementTrendEnabled() === c.trends &&
      isAnalyticsSnapshotsEnabled() === c.snapshots;

    let studentOk = false;
    let adminOk = false;
    let studentLatency = 0;
    let adminLatency = 0;
    let errorMsg = null;

    try {
      // Test Student Dashboard
      const t0 = performance.now();
      const sData = await getStudentDashboardData(studentId);
      studentLatency = Number((performance.now() - t0).toFixed(1));

      // Parity & Consistency Check
      const kpisMatch =
        sData.totalTestsAttempted === baselineStudent.totalTestsAttempted &&
        sData.percentageAchieved === baselineStudent.percentageAchieved &&
        sData.accuracy === baselineStudent.accuracy &&
        sData.allTests.length === baselineStudent.allTests.length;

      studentOk = kpisMatch;

      // Test Admin Dashboard
      const t1 = performance.now();
      const aData = await getAdminDashboardData();
      adminLatency = Number((performance.now() - t1).toFixed(1));

      const quickStatsMatch =
        JSON.stringify(aData.quickStats) === JSON.stringify(baselineAdmin.quickStats);

      const hasEngagementTrendPeriods =
        aData.studentEngagementTrend &&
        Array.isArray(aData.studentEngagementTrend.today) &&
        Array.isArray(aData.studentEngagementTrend.weekly) &&
        Array.isArray(aData.studentEngagementTrend.monthly) &&
        Array.isArray(aData.studentEngagementTrend.yearly);

      adminOk = quickStatsMatch && hasEngagementTrendPeriods;

    } catch (err) {
      errorMsg = err.message;
      console.error(`Error in combo ${i + 1}:`, err);
    }

    results.push({
      Combo: i + 1,
      Description: c.desc,
      Summaries: c.summaries ? "ON" : "OFF",
      Trends: c.trends ? "ON" : "OFF",
      Snapshots: c.snapshots ? "ON" : "OFF",
      "Flags Reactive": flagsMatch ? "YES" : "NO",
      "Student Status": studentOk ? "PASSED" : "FAILED",
      "Admin Status": adminOk ? "PASSED" : "FAILED",
      "Student Latency (ms)": studentLatency,
      "Admin Latency (ms)": adminLatency,
      Errors: errorMsg || "None",
    });
  }

  // Restore defaults
  process.env.USE_ANALYTICS_SUMMARIES = "true";
  process.env.USE_SUMMARY_ENGAGEMENT_TREND = "true";
  process.env.USE_ANALYTICS_SNAPSHOTS = "true";

  console.log("\n==================================================================");
  console.log("FEATURE FLAG ROLLBACK VERIFICATION MATRIX RESULTS");
  console.log("==================================================================");
  console.table(results);
  console.log("==================================================================\n");

  const allPassed = results.every(
    (r) => r["Student Status"] === "PASSED" && r["Admin Status"] === "PASSED" && r.Errors === "None"
  );

  if (allPassed) {
    console.log("SUCCESS: All 8 feature flag combinations verified with 100% data parity and zero errors!");
  } else {
    console.error("FAILURE: Some rollback combinations did not pass parity checks.");
    process.exit(1);
  }

  await mongoose.disconnect();
}

runRollbackMatrixVerification();
