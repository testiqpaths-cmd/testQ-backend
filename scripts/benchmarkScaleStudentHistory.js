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

async function runScaleBenchmarks() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Scale Benchmarking (100, 500, 1000 attempts).\n");

  // Pick an existing real test from the database
  const realTest = await Test.findOne({ isPublished: true }).lean();
  if (!realTest) {
    console.error("No published test found for benchmark fixture!");
    await mongoose.disconnect();
    return;
  }

  const scales = [100, 500, 1000];
  const ITERATIONS = 15;
  const scaleResults = [];

  for (const scale of scales) {
    console.log(`==================================================================`);
    console.log(`BENCHMARK AT SCALE: ${scale} ATTEMPTS`);
    console.log(`==================================================================`);

    const scaleStudentId = new mongoose.Types.ObjectId();
    const attemptsToInsert = [];
    const baseDate = new Date(Date.now() - scale * 3600000);

    for (let i = 0; i < scale; i++) {
      const submittedAt = new Date(baseDate.getTime() + i * 3600000);
      const isPass = i % 3 !== 0;
      attemptsToInsert.push({
        testId: realTest._id,
        studentId: scaleStudentId,
        status: "EVALUATED",
        duration: 45,
        endsAt: new Date(submittedAt.getTime() + 2700000),
        submittedAt: submittedAt,
        totalScore: isPass ? 75 : 30,
        maxScore: 100,
        percentage: isPass ? 75 : 30,
        resultStatus: isPass ? "PASS" : "FAIL",
        answers: [
          { questionId: realTest.questions?.[0] || new mongoose.Types.ObjectId(), isCorrect: isPass, selectedOption: "A" }
        ],
        analyticsSnapshot: {
          testName: realTest.title || `Test Batch #${i + 1}`,
          subject: "Quantitative Aptitude",
          topic: "Arithmetic",
          topics: ["Arithmetic"],
          category: realTest.type || "Standard",
          difficultyBreakdown: {
            Easy: { correct: isPass ? 1 : 0, wrong: isPass ? 0 : 1, skipped: 0 },
            Medium: { correct: 0, wrong: 0, skipped: 0 },
            Hard: { correct: 0, wrong: 0, skipped: 0 }
          },
          computedAt: submittedAt
        }
      });
    }

    console.log(`Inserting ${scale} synthetic test attempts...`);
    await TestAttempt.insertMany(attemptsToInsert);
    console.log(`Successfully seeded ${scale} attempts for student ${scaleStudentId}.\n`);

    // Warmup
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    for (let i = 0; i < 2; i++) await getStudentDashboardData(String(scaleStudentId));
    process.env.USE_ANALYTICS_SNAPSHOTS = "false";
    for (let i = 0; i < 2; i++) await getStudentDashboardData(String(scaleStudentId));

    // 1. Benchmark Optimized (Snapshots)
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    const optTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(String(scaleStudentId));
      optTimes.push(performance.now() - t0);
    }

    // 2. Benchmark Raw Fallback
    process.env.USE_ANALYTICS_SNAPSHOTS = "false";
    const rawTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(String(scaleStudentId));
      rawTimes.push(performance.now() - t0);
    }

    const optP50 = percentile(optTimes, 50).toFixed(2);
    const optP95 = percentile(optTimes, 95).toFixed(2);
    const rawP50 = percentile(rawTimes, 50).toFixed(2);
    const rawP95 = percentile(rawTimes, 95).toFixed(2);
    const p50Reduction = (((rawP50 - optP50) / rawP50) * 100).toFixed(1);
    const p95Reduction = (((rawP95 - optP95) / rawP95) * 100).toFixed(1);

    console.log(`Results for ${scale} Attempts:`);
    console.log(`  Optimized Snapshot Path: p50 = ${optP50} ms | p95 = ${optP95} ms`);
    console.log(`  Raw Fallback Path:       p50 = ${rawP50} ms | p95 = ${rawP95} ms`);
    console.log(`  Latency Reduction:       p50: ${p50Reduction}% | p95: ${p95Reduction}%\n`);

    scaleResults.push({
      scale,
      optP50,
      optP95,
      rawP50,
      rawP95,
      p50Reduction,
      p95Reduction,
    });

    // Cleanup synthetic records
    console.log(`Cleaning up ${scale} synthetic test attempts...`);
    await TestAttempt.deleteMany({ studentId: scaleStudentId });
    console.log(`Cleanup complete.\n`);
  }

  console.log("==================================================================");
  console.log("SCALE BENCHMARK SUMMARY TABLE");
  console.log("==================================================================");
  console.table(
    scaleResults.map((r) => ({
      Attempts: r.scale,
      "Opt p50 (ms)": r.optP50,
      "Opt p95 (ms)": r.optP95,
      "Raw p50 (ms)": r.rawP50,
      "Raw p95 (ms)": r.rawP95,
      "p50 Reduction": `${r.p50Reduction}%`,
      "p95 Reduction": `${r.p95Reduction}%`,
    }))
  );
  console.log("==================================================================\n");

  await mongoose.disconnect();
}

runScaleBenchmarks();
