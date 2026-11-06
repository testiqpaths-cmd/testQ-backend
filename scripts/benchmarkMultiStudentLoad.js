import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

const activeStudents = [
  "6a58fcec24446ef390bf4cf5", // 59 attempts
  "6a1a92c05a7178af23f4817d", // 43 attempts
  "6a4a12d9e0e39456cabb3738", // 38 attempts
  "6a4924c3c67ad236a60dc3aa", // 15 attempts
  "6a1f3c1aea4b5f4f1333b133", // 15 attempts
  "6a7af65b142ff44023fff19d", // 13 attempts
  "6a71795937180342eb5ccc6f", // 9 attempts
  "6a95b21d4db6497d9a1f530f", // 9 attempts
  "6a7af65d142ff44023fff1a3", // 7 attempts
  "6a1a7d509a1a04b7500be6b0", // 6 attempts
];

async function runMultiStudentBenchmark() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Multi-Student Concurrency & Event Loop Benchmark.\n");

  try {
    const TOTAL_REQUESTS = 100;
    const concurrencies = [1, 5, 10];
    const results = [];

    // Warmup
    for (let i = 0; i < 5; i++) {
      const studentId = activeStudents[i % activeStudents.length];
      await getStudentDashboardData(studentId);
    }

    for (const c of concurrencies) {
      console.log(`Running Load Test: Concurrency = ${c}, Requests = ${TOTAL_REQUESTS}, Multi-Student Request Mix...`);

      // Monitor Event Loop Delay
      const histogram = monitorEventLoopDelay({ resolution: 20 });
      histogram.enable();

      const latencies = [];
      let errors = 0;
      const startTime = performance.now();

      let requestIndex = 0;
      const worker = async () => {
        while (requestIndex < TOTAL_REQUESTS) {
          const currentIndex = requestIndex++;
          const studentId = activeStudents[currentIndex % activeStudents.length];
          const t0 = performance.now();
          try {
            await getStudentDashboardData(studentId);
            latencies.push(performance.now() - t0);
          } catch (e) {
            errors++;
            console.error(`Request error: ${e.message}`);
          }
        }
      };

      const workers = Array.from({ length: c }, () => worker());
      await Promise.all(workers);

      histogram.disable();
      const totalWallTimeMs = performance.now() - startTime;
      const rps = ((TOTAL_REQUESTS / totalWallTimeMs) * 1000).toFixed(1);

      const p50 = percentile(latencies, 50).toFixed(2);
      const p90 = percentile(latencies, 90).toFixed(2);
      const p95 = percentile(latencies, 95).toFixed(2);
      const p99 = percentile(latencies, 99).toFixed(2);
      const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
      const min = Math.min(...latencies).toFixed(2);
      const max = Math.max(...latencies).toFixed(2);
      const eventLoopP95 = (histogram.percentile(95) / 1e6).toFixed(2); // ms
      const eventLoopMax = (histogram.max / 1e6).toFixed(2); // ms

      results.push({
        Concurrency: c,
        "Reqs": TOTAL_REQUESTS,
        "p50 (ms)": p50,
        "p90 (ms)": p90,
        "p95 (ms)": p95,
        "p99 (ms)": p99,
        "Avg (ms)": avg,
        "Min (ms)": min,
        "Max (ms)": max,
        "Req/Sec": rps,
        "Err Rate": `${((errors / TOTAL_REQUESTS) * 100).toFixed(1)}%`,
        "EventLoop p95 (ms)": eventLoopP95,
      });
    }

    console.log("\n==================================================================");
    console.log("MULTI-STUDENT LOAD TEST RESULTS (N=100 per concurrency level)");
    console.log("==================================================================");
    console.table(results);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Benchmark failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runMultiStudentBenchmark();
