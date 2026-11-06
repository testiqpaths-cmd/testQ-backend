import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import TestAssignment from "../src/models/testAssignment.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import Test from "../src/models/test.model.js";
import Topic from "../src/models/topic.model.js";
import Subject from "../src/models/subject.model.js";
import Question from "../src/models/question.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function profileBreakdown() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Student Dashboard Timing Breakdown.\n");

  try {
    const studentId = "6a58fcec24446ef390bf4cf5";
    const studentObjectId = new mongoose.Types.ObjectId(studentId);
    const now = new Date();
    const ITERATIONS = 10;

    console.log(`Profiling student ${studentId} over ${ITERATIONS} iterations...\n`);

    const times = {
      testAssignmentAgg: [],
      summaryFind: [],
      attemptSnapshotFind: [],
      attemptPopulateFind: [],
      inMemoryLoop: [],
    };

    // Warmup
    for (let i = 0; i < 2; i++) {
      await TestAssignment.aggregate([
        { $match: { studentId: studentObjectId, status: { $in: ["ACCEPTED", "STARTED"] } } },
        { $lookup: { from: "tests", localField: "testId", foreignField: "_id", as: "test" } },
        { $unwind: "$test" },
        { $count: "count" },
      ]);
    }

    for (let i = 0; i < ITERATIONS; i++) {
      // 1. TestAssignment Aggregation
      const t1 = performance.now();
      await TestAssignment.aggregate([
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
      ]);
      times.testAssignmentAgg.push(performance.now() - t1);

      // 2. StudentPerformanceSummary.findOne
      const t2 = performance.now();
      await StudentPerformanceSummary.findOne({ studentId }).lean();
      times.summaryFind.push(performance.now() - t2);

      // 3. TestAttempt.find (Snapshot fast path)
      const t3 = performance.now();
      const attempts = await TestAttempt.find({
        studentId,
        status: { $in: ["SUBMITTED", "EVALUATED"] },
      })
        .sort({ submittedAt: 1 })
        .lean();
      times.attemptSnapshotFind.push(performance.now() - t3);

      // 4. TestAttempt.find + Deep Populate (Raw fallback)
      const t4 = performance.now();
      await TestAttempt.find({
        studentId,
        status: { $in: ["SUBMITTED", "EVALUATED"] },
      })
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
      times.attemptPopulateFind.push(performance.now() - t4);

      // 5. In-memory snapshot processing loop
      const t5 = performance.now();
      const recentTests = [];
      const allTests = [];
      const subjectCountMap = {};
      attempts.forEach((a) => {
        const snap = a.analyticsSnapshot;
        if (snap) {
          allTests.push({
            id: a.testId,
            resultId: a._id,
            name: snap.testName,
            subject: snap.subject,
            topic: snap.topic,
            difficultyBreakdown: snap.difficultyBreakdown,
          });
        }
      });
      times.inMemoryLoop.push(performance.now() - t5);
    }

    const avg = (arr) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);

    console.log("==================================================================");
    console.log("COMPONENT LATENCY BREAKDOWN (Averages over 10 iterations)");
    console.log("==================================================================");
    console.log(`1. TestAssignment.aggregate (activeAssignedTestsCount):  ${avg(times.testAssignmentAgg)} ms`);
    console.log(`2. StudentPerformanceSummary.findOne:                   ${avg(times.summaryFind)} ms`);
    console.log(`3. TestAttempt.find (Fast Snapshot Path):               ${avg(times.attemptSnapshotFind)} ms`);
    console.log(`4. TestAttempt.find + Populate (Raw Fallback Path):     ${avg(times.attemptPopulateFind)} ms`);
    console.log(`5. In-memory Snapshot loop:                             ${avg(times.inMemoryLoop)} ms`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Profile error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

profileBreakdown();
