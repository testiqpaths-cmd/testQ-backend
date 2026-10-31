import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import Test from "../src/models/test.model.js";
import Topic from "../src/models/topic.model.js";
import Subject from "../src/models/subject.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";
import {
  getDashboardTelemetryStats,
  resetTelemetryStats,
} from "../src/modules/analytics/dashboard/dashboardTelemetry.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function verifyTelemetry() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Dashboard Telemetry & Safeguards Verification.\n");

  try {
    resetTelemetryStats();
    const studentId = "6a58fcec24446ef390bf4cf5";

    // 1. Normal Request
    console.log("==================================================================");
    console.log("STEP 1: Recording Normal Dashboard Request");
    console.log("==================================================================");
    await getStudentDashboardData(studentId);
    let stats = getDashboardTelemetryStats();
    console.log("Telemetry after 1 normal request:", stats);
    const normalRecorded = stats.totalRequests === 1 && stats.fallbackCount === 0;
    console.log(`Normal request tracked: ${normalRecorded}\n`);

    // 2. Fallback Triggered by Missing Snapshot
    console.log("==================================================================");
    console.log("STEP 2: Recording Snapshot Fallback Event");
    console.log("==================================================================");
    const anAttempt = await TestAttempt.findOne({
      studentId: new mongoose.Types.ObjectId(studentId),
      status: { $in: ["SUBMITTED", "EVALUATED"] },
    });
    const originalSnapshot = anAttempt.analyticsSnapshot;

    // Invalidate snapshot
    await TestAttempt.updateOne({ _id: anAttempt._id }, { $set: { analyticsSnapshot: null } });

    await getStudentDashboardData(studentId);
    stats = getDashboardTelemetryStats();
    console.log("Telemetry after fallback request:", stats);
    const fallbackRecorded = stats.fallbackCount === 1 && stats.recentEvents.some((e) => e.type === "SNAPSHOT_FALLBACK");
    console.log(`Fallback event tracked and logged: ${fallbackRecorded}\n`);

    // Restore snapshot
    await TestAttempt.updateOne({ _id: anAttempt._id }, { $set: { analyticsSnapshot: originalSnapshot } });

    // 3. Discrepancy Event Trigger
    console.log("==================================================================");
    console.log("STEP 3: Recording Analytics Discrepancy Event");
    console.log("==================================================================");
    const originalSummary = await StudentPerformanceSummary.findOne({ studentId }).lean();
    if (originalSummary) {
      // Temporarily inject discrepancy
      await StudentPerformanceSummary.updateOne(
        { studentId },
        { $set: { totalTestsAttempted: originalSummary.totalTestsAttempted + 50 } }
      );

      await getStudentDashboardData(studentId);
      stats = getDashboardTelemetryStats();
      console.log("Telemetry after discrepancy request:", stats);
      const discrepancyRecorded = stats.discrepancyCount > 0 && stats.recentEvents.some((e) => e.type === "ANALYTICS_DISCREPANCY");
      console.log(`Discrepancy event tracked and logged: ${discrepancyRecorded}\n`);

      // Restore summary
      await StudentPerformanceSummary.updateOne(
        { studentId },
        { $set: { totalTestsAttempted: originalSummary.totalTestsAttempted } }
      );
    }

    console.log("==================================================================");
    console.log("FINAL TELEMETRY STATE");
    console.log("==================================================================");
    console.log(JSON.stringify(getDashboardTelemetryStats(), null, 2));
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Telemetry verification error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

verifyTelemetry();
