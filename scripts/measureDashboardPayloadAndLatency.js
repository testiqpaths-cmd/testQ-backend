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
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function measurePayloadAndLatency() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Payload & Endpoint Latency Measurement.\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5"; // Real student with 59 attempts
    const ITERATIONS = 20;

    // 1. Measure Payload Size & Serialization Time on real student
    console.log("==================================================================");
    console.log("SECTION 1: RESPONSE PAYLOAD SIZE & SERIALIZATION (59 Attempts)");
    console.log("==================================================================");

    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    process.env.USE_ANALYTICS_SUMMARIES = "true";

    const data = await getStudentDashboardData(studentId);

    const tSerStart = performance.now();
    const jsonString = JSON.stringify(data);
    const serTimeMs = (performance.now() - tSerStart).toFixed(3);

    const totalBytes = Buffer.byteLength(jsonString, "utf8");
    const totalKB = (totalBytes / 1024).toFixed(2);

    const allTestsBytes = Buffer.byteLength(JSON.stringify(data.allTests), "utf8");
    const allTestsKB = (allTestsBytes / 1024).toFixed(2);
    const allTestsShare = ((allTestsBytes / totalBytes) * 100).toFixed(1);

    const testsBytes = Buffer.byteLength(JSON.stringify(data.tests), "utf8");
    const testsKB = (testsBytes / 1024).toFixed(2);

    const kpiSummaryBytes = totalBytes - allTestsBytes - testsBytes;
    const kpiSummaryKB = (kpiSummaryBytes / 1024).toFixed(2);

    console.log(`Total Response Payload:         ${totalKB} KB (${totalBytes} bytes)`);
    console.log(`  - allTests payload:           ${allTestsKB} KB (${allTestsShare}% of total)`);
    console.log(`  - tests (recentTests) payload:${testsKB} KB`);
    console.log(`  - KPIs & timelines:           ${kpiSummaryKB} KB`);
    console.log(`JSON Serialization Time:        ${serTimeMs} ms`);
    console.log("==================================================================\n");

    // 2. Measure Payload Projection at Scale (100, 500, 1000 attempts)
    console.log("==================================================================");
    console.log("SECTION 2: PAYLOAD SIZE PROJECTION AT SCALE");
    console.log("==================================================================");

    const sampleAttemptObj = data.allTests[0];
    const avgAttemptBytes = Buffer.byteLength(JSON.stringify(sampleAttemptObj), "utf8");

    const scaleProjections = [59, 100, 500, 1000, 2000].map((count) => {
      const estimatedAllTestsBytes = avgAttemptBytes * count;
      const estimatedTotalBytes = estimatedAllTestsBytes + avgAttemptBytes * Math.min(count, 50) + 2048; // KPIs + timelines
      return {
        Attempts: count,
        "Single Attempt": `${avgAttemptBytes} B`,
        "allTests Size": `${(estimatedAllTestsBytes / 1024).toFixed(1)} KB`,
        "Estimated Total Payload": `${(estimatedTotalBytes / 1024).toFixed(1)} KB`,
        "Estimated MB": (estimatedTotalBytes / (1024 * 1024)).toFixed(2) + " MB",
      };
    });

    console.table(scaleProjections);
    console.log("==================================================================\n");

    // 3. End-to-End Latency Benchmark (with new Compound Index + Concurrent Promise.all)
    console.log("==================================================================");
    console.log("SECTION 3: END-TO-END ENDPOINT LATENCY (Concurrent + Indexed)");
    console.log("==================================================================");

    // Warmup
    for (let i = 0; i < 3; i++) await getStudentDashboardData(studentId);

    const endpointTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(studentId);
      endpointTimes.push(performance.now() - t0);
    }

    const p50 = percentile(endpointTimes, 50).toFixed(2);
    const p95 = percentile(endpointTimes, 95).toFixed(2);
    const avg = (endpointTimes.reduce((a, b) => a + b, 0) / endpointTimes.length).toFixed(2);
    const min = Math.min(...endpointTimes).toFixed(2);
    const max = Math.max(...endpointTimes).toFixed(2);

    console.log(`Student ID:              ${studentId} (59 attempts)`);
    console.log(`Iterations:              ${ITERATIONS} runs`);
    console.log(`Minimum Latency:         ${min} ms`);
    console.log(`Median (p50) Latency:    ${p50} ms`);
    console.log(`Average Latency:         ${avg} ms`);
    console.log(`95th Percentile (p95):   ${p95} ms`);
    console.log(`Maximum Latency:         ${max} ms`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Payload measurement error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

measurePayloadAndLatency();
