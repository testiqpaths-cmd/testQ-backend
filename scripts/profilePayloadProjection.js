import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function profileProjection() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for TestAttempt Document Size & Projection Profiling.\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5";
    const ITERATIONS = 15;

    // 1. Fetch full documents (Current behavior: no projection)
    const fullDocs = await TestAttempt.find({
      studentId,
      status: { $in: ["SUBMITTED", "EVALUATED"] },
    })
      .sort({ submittedAt: 1 })
      .lean();

    const fullBytes = Buffer.byteLength(JSON.stringify(fullDocs));
    const fullKB = (fullBytes / 1024).toFixed(2);

    // 2. Fetch with projection excluding questionSnapshots and violations
    const projectedDocs = await TestAttempt.find({
      studentId,
      status: { $in: ["SUBMITTED", "EVALUATED"] },
    })
      .select("-questionSnapshots -violations")
      .sort({ submittedAt: 1 })
      .lean();

    const projectedBytes = Buffer.byteLength(JSON.stringify(projectedDocs));
    const projectedKB = (projectedBytes / 1024).toFixed(2);

    console.log("==================================================================");
    console.log("DOCUMENT SIZE OVER WIRE (59 Attempts)");
    console.log("==================================================================");
    console.log(`Full Documents (including questionSnapshots):     ${fullKB} KB (${fullBytes} bytes)`);
    console.log(`Projected Documents (excluding questionSnapshots):  ${projectedKB} KB (${projectedBytes} bytes)`);
    console.log(`Size Reduction:                                    ${(((fullBytes - projectedBytes) / fullBytes) * 100).toFixed(1)}%`);
    console.log("==================================================================\n");

    // 3. Timing Comparison over 15 iterations
    // Warmup
    for (let i = 0; i < 3; i++) {
      await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } }).sort({ submittedAt: 1 }).lean();
      await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } }).select("-questionSnapshots -violations").sort({ submittedAt: 1 }).lean();
    }

    const fullTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } })
        .sort({ submittedAt: 1 })
        .lean();
      fullTimes.push(performance.now() - t0);
    }

    const projTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } })
        .select("-questionSnapshots -violations")
        .sort({ submittedAt: 1 })
        .lean();
      projTimes.push(performance.now() - t0);
    }

    const avgFull = (fullTimes.reduce((a, b) => a + b, 0) / fullTimes.length).toFixed(2);
    const avgProj = (projTimes.reduce((a, b) => a + b, 0) / projTimes.length).toFixed(2);

    console.log("==================================================================");
    console.log("QUERY RETRIEVAL & DESERIALIZATION TIME");
    console.log("==================================================================");
    console.log(`Full Documents Retrieval:     ${avgFull} ms`);
    console.log(`Projected Documents Retrieval:${avgProj} ms`);
    console.log(`Time Difference:              ${(avgFull - avgProj).toFixed(2)} ms`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Profiling error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

profileProjection();
