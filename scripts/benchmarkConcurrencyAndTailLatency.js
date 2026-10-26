import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import TestAssignment from "../src/models/testAssignment.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runConcurrencyBenchmark() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Concurrency & Tail Latency Benchmark (p50, p90, p95, p99).\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5";
    const TOTAL_REQUESTS = 50;
    const concurrencies = [1, 5, 10];
    const results = [];

    // Warmup
    for (let i = 0; i < 3; i++) await getStudentDashboardData(studentId);

    for (const c of concurrencies) {
      console.log(`Testing Concurrency = ${c} (Total Requests = ${TOTAL_REQUESTS})...`);
      const latencies = [];
      const startTime = performance.now();

      let completed = 0;
      const worker = async () => {
        while (completed < TOTAL_REQUESTS) {
          completed++;
          const t0 = performance.now();
          await getStudentDashboardData(studentId);
          latencies.push(performance.now() - t0);
        }
      };

      const workers = Array.from({ length: c }, () => worker());
      await Promise.all(workers);

      const totalWallTimeMs = performance.now() - startTime;
      const rps = ((TOTAL_REQUESTS / totalWallTimeMs) * 1000).toFixed(1);

      const p50 = percentile(latencies, 50).toFixed(2);
      const p90 = percentile(latencies, 90).toFixed(2);
      const p95 = percentile(latencies, 95).toFixed(2);
      const p99 = percentile(latencies, 99).toFixed(2);
      const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
      const min = Math.min(...latencies).toFixed(2);
      const max = Math.max(...latencies).toFixed(2);

      results.push({
        Concurrency: c,
        "p50 (ms)": p50,
        "p90 (ms)": p90,
        "p95 (ms)": p95,
        "p99 (ms)": p99,
        "Avg (ms)": avg,
        "Min (ms)": min,
        "Max (ms)": max,
        "Req/Sec": rps,
      });
    }

    console.log("\n==================================================================");
    console.log("CONCURRENCY & TAIL LATENCY SUMMARY TABLE");
    console.log("==================================================================");
    console.table(results);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Concurrency benchmark error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runConcurrencyBenchmark();
