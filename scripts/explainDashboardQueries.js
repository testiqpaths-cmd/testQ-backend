import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import TestAssignment from "../src/models/testAssignment.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function explainQueries() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for explain('executionStats') inspection.\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5";
    const studentObjectId = new mongoose.Types.ObjectId(studentId);
    const now = new Date();

    // 1. Explain TestAttempt.find
    console.log("===============================================================");
    console.log("QUERY 1: TestAttempt.find (Student Completed Attempts)");
    console.log("===============================================================");
    const attemptExplain = await TestAttempt.find({
      studentId,
      status: { $in: ["SUBMITTED", "EVALUATED"] },
    })
      .sort({ submittedAt: 1 })
      .explain("executionStats");

    const attemptStats = attemptExplain.executionStats;
    console.log(`Execution Success:        ${attemptStats.executionSuccess}`);
    console.log(`Total Docs Examined:      ${attemptStats.totalDocsExamined}`);
    console.log(`Total Keys Examined:      ${attemptStats.totalKeysExamined}`);
    console.log(`Docs Returned (nReturned):${attemptStats.nReturned}`);
    console.log(`Execution Time (ms):      ${attemptStats.executionTimeMillis} ms`);

    const attemptStage = attemptStats.executionStages;
    console.log(`Winning Stage:            ${attemptStage.stage}`);
    console.log(`Index Used:               ${attemptStage.inputStage?.indexName || attemptStage.indexName || "None (COLLSCAN)"}`);
    console.log(`Sort Stage present?       ${attemptStats.executionStages.stage === "SORT" ? "YES (In-memory sort)" : "NO (Index-provided sort)"}`);
    console.log("===============================================================\n");

    // 2. Explain TestAssignment.aggregate
    console.log("===============================================================");
    console.log("QUERY 2: TestAssignment.aggregate (Active Assigned Tests)");
    console.log("===============================================================");
    const assignmentExplain = await TestAssignment.aggregate([
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

    console.log("Assignment Aggregation Stages:");
    const stages = assignmentExplain.stages || assignmentExplain;
    console.log(JSON.stringify(stages, null, 2).slice(0, 2000));
    console.log("===============================================================\n");

  } catch (err) {
    console.error("Explain error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

explainQueries();
