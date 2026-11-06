import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import "../../src/models/subject.model.js";
import TestAttempt from "../../src/models/testAttempt.model.js";
import Test from "../../src/models/test.model.js";
import User from "../../src/modules/auth/models/User.model.js";
import HelpSupport from "../../src/modules/help-support/helpSupport.model.js";
import TestSeries from "../../src/models/testSeries.model.js";
import TestSeriesAssignment from "../../src/models/testSeriesAssignment.model.js";
import DailyStudentActivity from "../../src/models/dailyStudentActivity.model.js";

async function profileQueries() {
  console.log("=== Profiling Dashboard Queries for E2.8.1 ===\n");
  await mongoose.connect(process.env.MONGO_URI);

  const timeQuery = async (name, fn) => {
    const start = performance.now();
    await fn();
    const duration = (performance.now() - start).toFixed(2);
    console.log(`[${duration}ms] ${name}`);
    return duration;
  };

  // 1. Attempts query (Stream 3 with populate)
  await timeQuery("Stream 3: TestAttempt.find().sort({ submittedAt: -1, updatedAt: -1 }).limit(100) with populate", async () => {
    return TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
      .select("-questionSnapshots -violations")
      .populate("studentId", "firstName lastName email")
      .populate({
        path: "testId",
        select: "title subjectIds passingPercentage",
        populate: { path: "subjectIds", select: "name" },
      })
      .sort({ submittedAt: -1, updatedAt: -1 })
      .limit(100)
      .lean();
  });

  // 1b. Attempts query WITHOUT nested populate
  await timeQuery("Stream 3 (without populate): TestAttempt.find().limit(100)", async () => {
    return TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
      .select("-questionSnapshots -violations")
      .sort({ submittedAt: -1, updatedAt: -1 })
      .limit(100)
      .lean();
  });

  // 2. Stream 1 counts
  await timeQuery("Stream 1: 8 Test.countDocuments queries", async () => {
    return Promise.all([
      Test.countDocuments({ isDeleted: { $ne: 1 } }),
      Test.countDocuments({ isDeleted: { $ne: 1 }, isPublished: false }),
      Test.countDocuments({ isDeleted: { $ne: 1 }, isPublished: true }),
      Test.countDocuments({ isDeleted: { $ne: 1 }, "createdBy.role": "IQPATH_ADMIN" }),
      Test.countDocuments({ isDeleted: { $ne: 1 }, "createdBy.role": "ORGANIZATION" }),
    ]);
  });

  // 3. HelpSupport counts
  await timeQuery("Stream 1: 3 HelpSupport.countDocuments queries", async () => {
    return Promise.all([
      HelpSupport.countDocuments({}),
      HelpSupport.countDocuments({ status: "pending" }),
      HelpSupport.countDocuments({ status: "resolved" }),
    ]);
  });

  // 4. DailyStudentActivity query (Stream 6)
  await timeQuery("Stream 6: DailyStudentActivity.find({ dateKey: { $gte } })", async () => {
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 6);
    const minimumDateKey = minDate.toISOString().slice(0, 10);
    return DailyStudentActivity.find({ dateKey: { $gte: minimumDateKey } })
      .select("dateKey studentId sourceCategory")
      .lean();
  });

  // 5. Check total attempt count in DB vs 100 limit
  const totalCompletedAttempts = await TestAttempt.countDocuments({
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  });
  console.log(`\nTotal completed attempts in database: ${totalCompletedAttempts}`);
  console.log(`Attempts loaded for Performance/AvgScore/Subject charts: ${Math.min(100, totalCompletedAttempts)}`);
  if (totalCompletedAttempts > 100) {
    console.log(`⚠️ DISCREPANCY: ${totalCompletedAttempts - 100} completed attempts are excluded from charts due to .limit(100)!`);
  }

  await mongoose.disconnect();
}

profileQueries();
