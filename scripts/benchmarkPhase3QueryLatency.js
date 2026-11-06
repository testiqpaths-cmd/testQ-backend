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

async function benchmark() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Query Latency vs Total Endpoint Benchmark.\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5"; // student with 59 attempts
    const ITERATIONS = 15;

    console.log(`Benchmarking with Student: ${studentId} (59 attempts) over ${ITERATIONS} iterations.`);

    // --- 1. Pure Query Latency: Snapshot (Indexed Find only) ---
    // Warmup
    for (let i = 0; i < 3; i++) {
      await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } }).sort({ submittedAt: 1 }).lean();
    }
    const snapQueryTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } }).sort({ submittedAt: 1 }).lean();
      snapQueryTimes.push(performance.now() - t0);
    }

    // --- 2. Pure Query Latency: Raw Fallback (Find + Deep 3-Level Populate + Bulk Question.find) ---
    // Warmup
    for (let i = 0; i < 3; i++) {
      const atts = await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } })
        .populate({
          path: "testId",
          select: "title visibility type duration topicIds subjectIds subjectId difficulty",
          populate: [
            { path: "topicIds", select: "name" },
            { path: "subjectIds", select: "name" },
            { path: "subjectId", select: "name" },
          ],
        })
        .sort({ submittedAt: 1 })
        .lean();
      const qIds = new Set();
      atts.forEach((a) => (a.answers || []).forEach((ans) => ans.questionId && qIds.add(String(ans.questionId))));
      await Question.find({ _id: { $in: Array.from(qIds) } }).select("difficulty").lean();
    }

    const rawQueryTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const atts = await TestAttempt.find({ studentId, status: { $in: ["SUBMITTED", "EVALUATED"] } })
        .populate({
          path: "testId",
          select: "title visibility type duration topicIds subjectIds subjectId difficulty",
          populate: [
            { path: "topicIds", select: "name" },
            { path: "subjectIds", select: "name" },
            { path: "subjectId", select: "name" },
          ],
        })
        .sort({ submittedAt: 1 })
        .lean();
      const qIds = new Set();
      atts.forEach((a) => (a.answers || []).forEach((ans) => ans.questionId && qIds.add(String(ans.questionId))));
      await Question.find({ _id: { $in: Array.from(qIds) } }).select("difficulty").lean();
      rawQueryTimes.push(performance.now() - t0);
    }

    // --- 3. Total Endpoint Latency: USE_ANALYTICS_SNAPSHOTS="true" ---
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    process.env.USE_ANALYTICS_SUMMARIES = "true";
    for (let i = 0; i < 3; i++) await getStudentDashboardData(studentId);
    const totalOptTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(studentId);
      totalOptTimes.push(performance.now() - t0);
    }

    // --- 4. Total Endpoint Latency: USE_ANALYTICS_SNAPSHOTS="false" ---
    process.env.USE_ANALYTICS_SNAPSHOTS = "false";
    process.env.USE_ANALYTICS_SUMMARIES = "true";
    for (let i = 0; i < 3; i++) await getStudentDashboardData(studentId);
    const totalRawTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      await getStudentDashboardData(studentId);
      totalRawTimes.push(performance.now() - t0);
    }

    const avgSnapQuery = (snapQueryTimes.reduce((a, b) => a + b, 0) / snapQueryTimes.length).toFixed(2);
    const avgRawQuery = (rawQueryTimes.reduce((a, b) => a + b, 0) / rawQueryTimes.length).toFixed(2);
    const querySpeedup = (avgRawQuery / avgSnapQuery).toFixed(2);
    const queryReduction = (((avgRawQuery - avgSnapQuery) / avgRawQuery) * 100).toFixed(1);

    const avgTotalOpt = (totalOptTimes.reduce((a, b) => a + b, 0) / totalOptTimes.length).toFixed(2);
    const avgTotalRaw = (totalRawTimes.reduce((a, b) => a + b, 0) / totalRawTimes.length).toFixed(2);
    const totalSpeedup = (avgTotalRaw / avgTotalOpt).toFixed(2);
    const totalReduction = (((avgTotalRaw - avgTotalOpt) / avgTotalRaw) * 100).toFixed(1);

    console.log("==================================================================");
    console.log("DATABASE QUERY LATENCY (Attempts + Test Populates + Question Lookup)");
    console.log("==================================================================");
    console.log(`Snapshot Query (Single indexed find):          ${avgSnapQuery} ms`);
    console.log(`Raw Query (Find + Deep Populate + Questions):   ${avgRawQuery} ms`);
    console.log(`Query Speedup:                                  ${querySpeedup}x faster`);
    console.log(`Query Latency Reduction:                        ${queryReduction}%`);
    console.log("==================================================================\n");

    console.log("==================================================================");
    console.log("TOTAL ENDPOINT LATENCY (Including activeAssignedTestsCount aggregation)");
    console.log("==================================================================");
    console.log(`Optimized Endpoint Latency:                     ${avgTotalOpt} ms`);
    console.log(`Raw Fallback Endpoint Latency:                  ${avgTotalRaw} ms`);
    console.log(`Total Speedup:                                  ${totalSpeedup}x faster`);
    console.log(`Total Latency Reduction:                        ${totalReduction}%`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Benchmark error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

benchmark();
