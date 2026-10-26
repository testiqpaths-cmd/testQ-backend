import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAssignment from "../src/models/testAssignment.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function verifyIndex() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for TestAssignment Index Verification.\n");

  try {
    // 1. Sync indexes to create the compound index on MongoDB
    console.log("Syncing indexes on TestAssignment collection...");
    await TestAssignment.syncIndexes();

    const indexes = await TestAssignment.collection.getIndexes();
    console.log("Current TestAssignment Indexes:", Object.keys(indexes));

    const hasCompoundIndex = "studentId_1_status_1" in indexes;
    console.log(`Compound index studentId_1_status_1 present: ${hasCompoundIndex}\n`);

    // 2. Explain executionStats
    const studentId = "6a58fcec24446ef390bf4cf5";
    const studentObjectId = new mongoose.Types.ObjectId(studentId);
    const now = new Date();

    const explain = await TestAssignment.aggregate([
      {
        $match: {
          studentId: studentObjectId,
          status: { $in: ["ACCEPTED", "STARTED"] },
        },
      },
      {
        $lookup: {
          from: "tests",
          localField: "testId",
          foreignField: "_id",
          as: "test",
        },
      },
      { $unwind: "$test" },
      {
        $match: {
          "test.isPublished": true,
          "test.isDeleted": { $ne: 1 },
          $or: [
            { "test.scheduleType": "IMMEDIATE" },
            {
              "test.scheduleType": "FIXED",
              "test.startTime": { $lte: now },
              "test.endTime": { $gte: now },
            },
          ],
        },
      },
      { $count: "count" },
    ]).explain("executionStats");

    const cursorStage = explain.stages[0].$cursor;
    const plan = cursorStage.queryPlanner.winningPlan;
    const stats = cursorStage.executionStats;

    console.log("==================================================================");
    console.log("TESTASSIGNMENT AGGREGATION EXPLAIN STATS");
    console.log("==================================================================");
    console.log(`Winning Stage:             ${plan.stage || plan.inputStage?.stage}`);
    console.log(`Index Used:                ${plan.inputStage?.inputStage?.indexName || plan.inputStage?.indexName || plan.indexName}`);
    console.log(`Total Keys Examined:       ${stats.totalKeysExamined}`);
    console.log(`Total Docs Examined:       ${stats.totalDocsExamined}`);
    console.log(`Matched Documents:         ${stats.nReturned}`);
    console.log(`Cursor Execution Time:     ${stats.executionTimeMillis} ms`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Verification error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

verifyIndex();
