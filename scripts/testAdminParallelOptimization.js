import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/modules/auth/models/User.model.js";
import Organization from "../src/models/organization.model.js";
import Test from "../src/models/test.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import TestAssignment from "../src/models/testAssignment.model.js";
import TestSeries from "../src/models/testSeries.model.js";
import TestSeriesAssignment from "../src/models/testSeriesAssignment.model.js";
import HelpSupport from "../src/modules/help-support/helpSupport.model.js";
import UserSubscription from "../src/modules/subscription/models/UserSubscription.model.js";
import Subject from "../src/models/subject.model.js";
import Topic from "../src/models/topic.model.js";
import DailyStudentActivity from "../src/models/dailyStudentActivity.model.js";
import { getAdminDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function benchmarkAdminParallel() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Admin Dashboard Parallelization Experiment.\n");

  try {
    process.env.USE_SUMMARY_ENGAGEMENT_TREND = "true";

    // Measure existing sequential baseline
    console.log("1. Existing Sequential getAdminDashboardData() (3 runs)...");
    const baselineTimes = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await getAdminDashboardData();
      baselineTimes.push(performance.now() - t0);
    }
    const avgBaseline = (baselineTimes.reduce((a, b) => a + b, 0) / baselineTimes.length).toFixed(2);
    console.log(`   Baseline Avg: ${avgBaseline} ms (${baselineTimes.map(t => t.toFixed(0)).join(", ")} ms)\n`);

    // Measure Parallelized implementation
    console.log("2. Testing Fully Parallelized Execution with Projection (3 runs)...");
    const parallelTimes = [];

    const runParallelAdmin = async () => {
      const { start, end } = (() => {
        const s = new Date();
        s.setHours(0, 0, 0, 0);
        const e = new Date(s);
        e.setDate(e.getDate() + 1);
        return { start: s, end: e };
      })();

      const now = new Date();
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const liveActiveCondition = {
        isPublished: true,
        $or: [
          { scheduleType: "IMMEDIATE" },
          { scheduleType: "FIXED", startTime: { $lte: now }, endTime: { $gte: now } },
        ],
      };
      const liveCompletedCondition = {
        $or: [
          { status: "COMPLETED" },
          { scheduleType: "FIXED", isPublished: true, endTime: { $lt: now } },
        ],
      };
      const liveScheduledCondition = {
        isPublished: true,
        $or: [
          { scheduleType: "DELAYED" },
          { scheduleType: "FIXED", startTime: { $gt: now } },
        ],
      };
      const testFilter = { isDeleted: { $ne: 1 } };
      const studentFilter = { role: "STUDENT", isDeleted: { $ne: true } };

      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 6);
      const minimumDateKey = minDate.toISOString().slice(0, 10);

      // Execute all 6 independent streams in parallel via Promise.all!
      const [
        countsBatch1,
        assignmentCounts,
        recentAttempts,
        todayAttemptsCount,
        engagementData,
        testSeriesData,
      ] = await Promise.all([
        // Stream 1: Counts & subscription aggregate
        Promise.all([
          User.countDocuments(studentFilter),
          Organization.countDocuments(),
          Test.countDocuments({ ...testFilter, ...liveActiveCondition }),
          Test.countDocuments({ ...testFilter, ...liveActiveCondition, "createdBy.role": "IQPATH_ADMIN" }),
          Test.countDocuments({ ...testFilter, ...liveActiveCondition, "createdBy.role": "ORGANIZATION" }),
          Test.countDocuments(testFilter),
          Test.countDocuments({ ...testFilter, ...liveCompletedCondition }),
          Test.countDocuments({
            ...testFilter,
            $or: [
              { startTime: { $gte: start, $lt: end } },
              { createdAt: { $gte: start, $lt: end } },
            ],
          }),
          Test.countDocuments({ ...testFilter, ...liveScheduledCondition }),
          HelpSupport.countDocuments({}),
          HelpSupport.countDocuments({ status: "pending" }),
          HelpSupport.countDocuments({ status: "resolved" }),
          UserSubscription.aggregate([
            { $match: { status: "ACTIVE" } },
            { $lookup: { from: "plans", localField: "planId", foreignField: "_id", as: "plan" } },
            { $unwind: "$plan" },
            { $lookup: { from: "roles", localField: "plan.roleId", foreignField: "_id", as: "role" } },
            { $unwind: "$role" },
            { $group: { _id: { roleName: "$role.name", planName: "$plan.name", planId: "$plan._id", price: "$plan.price" }, count: { $sum: 1 } } }
          ]),
          Test.countDocuments({ ...testFilter, isPublished: false }),
          Test.countDocuments({ ...testFilter, isPublished: true }),
          TestSeries.countDocuments({}),
          User.countDocuments({ ...studentFilter, createdAt: { $gte: monthStart } }),
        ]),

        // Stream 2: Assignment counts
        Promise.all([
          TestAssignment.countDocuments({ status: "ACCEPTED" }),
          TestAssignment.countDocuments({ status: "DECLINED" }),
          TestAssignment.countDocuments({ status: "MISSED" }),
        ]),

        // Stream 3: Recent 100 attempts with projection
        TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
          .select("-questionSnapshots -violations")
          .populate("studentId", "firstName lastName email")
          .populate({
            path: "testId",
            select: "title subjectIds",
            populate: { path: "subjectIds", select: "name" },
          })
          .sort({ submittedAt: -1, updatedAt: -1 })
          .limit(100)
          .lean(),

        // Stream 4: Today attempts count
        TestAttempt.countDocuments({
          status: { $in: ["SUBMITTED", "EVALUATED"] },
          submittedAt: { $gte: start, $lt: end },
        }),

        // Stream 5: Engagement trend data
        Promise.all([
          TestAttempt.find({
            status: { $in: ["SUBMITTED", "EVALUATED"] },
            submittedAt: { $gte: start, $lt: end },
          })
            .select("studentId submittedAt updatedAt createdAt testId")
            .populate({ path: "testId", select: "createdBy isIQRoomTest" })
            .lean(),
          DailyStudentActivity.find({
            dateKey: { $gte: minimumDateKey },
          })
            .select("dateKey studentId sourceCategory")
            .lean(),
        ]),

        // Stream 6: Test series overview
        (async () => {
          const series = await TestSeries.find({})
            .select("title tests")
            .sort({ createdAt: -1 })
            .lean();
          const seriesAssignments = await TestSeriesAssignment.aggregate([
            {
              $match: {
                seriesId: { $in: series.map((item) => item._id) },
                status: "ACCEPTED",
              },
            },
            { $group: { _id: "$seriesId", students: { $sum: 1 } } },
          ]);
          return { series, seriesAssignments };
        })(),
      ]);

      return true;
    };

    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await runParallelAdmin();
      parallelTimes.push(performance.now() - t0);
    }
    const avgParallel = (parallelTimes.reduce((a, b) => a + b, 0) / parallelTimes.length).toFixed(2);
    console.log(`   Parallel Avg: ${avgParallel} ms (${parallelTimes.map(t => t.toFixed(0)).join(", ")} ms)`);

    const reductionPercent = (((avgBaseline - avgParallel) / avgBaseline) * 100).toFixed(1);
    console.log(`\n   LATENCY REDUCTION: ${avgBaseline} ms -> ${avgParallel} ms (${reductionPercent}% LOWER)`);

  } catch (err) {
    console.error("Benchmark error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

benchmarkAdminParallel();
