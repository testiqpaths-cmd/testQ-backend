import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import Subject from "../src/models/subject.model.js";
import Topic from "../src/models/topic.model.js";
import { getAdminDashboardData, getOrganizationDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function testAdminDashboard() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Admin Dashboard benchmark.\n");

  try {
    // Warm-up call
    process.env.USE_SUMMARY_ENGAGEMENT_TREND = "true";
    await getAdminDashboardData();

    // Benchmark Optimized (3 runs)
    process.env.USE_SUMMARY_ENGAGEMENT_TREND = "true";
    const optTimes = [];
    let optData;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      optData = await getAdminDashboardData();
      optTimes.push(performance.now() - t0);
    }

    // Benchmark Raw Fallback (3 runs)
    process.env.USE_SUMMARY_ENGAGEMENT_TREND = "false";
    const rawTimes = [];
    let rawData;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      rawData = await getAdminDashboardData();
      rawTimes.push(performance.now() - t0);
    }

    const avgOpt = (optTimes.reduce((a, b) => a + b, 0) / optTimes.length).toFixed(2);
    const avgRaw = (rawTimes.reduce((a, b) => a + b, 0) / rawTimes.length).toFixed(2);

    console.log("=================================================");
    console.log("STEADY-STATE BENCHMARK (Average of 3 runs)");
    console.log("=================================================");
    console.log(`Optimized (DailyStudentActivity): ${avgOpt}ms (${optTimes.map(t => t.toFixed(0)).join(", ")}ms)`);
    console.log(`Raw Fallback (allAttempts populate): ${avgRaw}ms (${rawTimes.map(t => t.toFixed(0)).join(", ")}ms)`);
    console.log(`Delta: ${(avgRaw - avgOpt).toFixed(2)}ms difference`);

    console.log("\n=================================================");
    console.log("OUTPUT VERIFICATION");
    console.log("=================================================");
    console.log(`Top level keys match: ${JSON.stringify(Object.keys(optData).sort()) === JSON.stringify(Object.keys(rawData).sort())}`);
    
    for (const period of ["today", "weekly", "monthly", "yearly"]) {
      const match = JSON.stringify(optData.studentEngagementTrend[period]) === JSON.stringify(rawData.studentEngagementTrend[period]);
      console.log(`Period [${period}]: rows count=${optData.studentEngagementTrend[period].length}, match=${match}`);
    }

    console.log(`Tests KPI match: ${JSON.stringify(optData.tests) === JSON.stringify(rawData.tests)}`);
    console.log(`Students KPI match: ${JSON.stringify(optData.students) === JSON.stringify(rawData.students)}`);
    console.log(`Today attempts match: ${optData.todayAttempts === rawData.todayAttempts}`);

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB.");
  }
}

testAdminDashboard();
