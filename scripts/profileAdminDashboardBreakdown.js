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

async function profileAdminDashboard() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Admin Dashboard Query Breakdown Profiling.\n");

  try {
    process.env.USE_SUMMARY_ENGAGEMENT_TREND = "true";

    // 1. Overall endpoint latency
    console.log("1. Measuring full getAdminDashboardData() baseline...");
    for (let i = 0; i < 2; i++) await getAdminDashboardData(); // warmup
    const t0 = performance.now();
    await getAdminDashboardData();
    const totalTime = performance.now() - t0;
    console.log(`   Full getAdminDashboardData() executed in: ${totalTime.toFixed(2)} ms\n`);

    // 2. Profile individual stages
    console.log("2. Profiling individual stages of buildAdminOrgDashboardData:");

    // Stage A: Count queries batch 1 (Users, Tests, HelpSupport, Subscriptions)
    const tA = performance.now();
    const now = new Date();
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
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    await Promise.all([
      User.countDocuments({ role: "STUDENT", isDeleted: { $ne: true } }),
      Organization.countDocuments(),
      Test.countDocuments({ ...testFilter, ...liveActiveCondition }),
      Test.countDocuments({ ...testFilter, ...liveActiveCondition, "createdBy.role": "IQPATH_ADMIN" }),
      Test.countDocuments({ ...testFilter, ...liveActiveCondition, "createdBy.role": "ORGANIZATION" }),
      Test.countDocuments(testFilter),
      Test.countDocuments({ ...testFilter, ...liveCompletedCondition }),
      Test.countDocuments(testFilter),
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
      User.countDocuments({ role: "STUDENT", isDeleted: { $ne: true }, createdAt: { $gte: monthStart } }),
    ]);
    const timeA = performance.now() - tA;
    console.log(`   Stage A: Batch 1 Counts & Subscription Aggregate (17 queries): ${timeA.toFixed(2)} ms`);

    // Stage B: Assignment counts
    const tB = performance.now();
    await Promise.all([
      TestAssignment.countDocuments({ status: "ACCEPTED" }),
      TestAssignment.countDocuments({ status: "DECLINED" }),
      TestAssignment.countDocuments({ status: "MISSED" }),
    ]);
    const timeB = performance.now() - tB;
    console.log(`   Stage B: TestAssignment countDocuments (3 queries): ${timeB.toFixed(2)} ms`);

    // Stage C: Recent attempts (100 attempts with nested populate)
    const tC = performance.now();
    const attempts = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
      .populate("studentId", "firstName lastName email")
      .populate({
        path: "testId",
        select: "title subjectIds",
        populate: { path: "subjectIds", select: "name" },
      })
      .sort({ submittedAt: -1, updatedAt: -1 })
      .limit(100)
      .lean();
    const timeC = performance.now() - tC;
    console.log(`   Stage C: TestAttempt.find(100) with studentId + testId nested populate: ${timeC.toFixed(2)} ms`);

    // Stage C2: TestAttempt.find(100) WITH field projection
    const tC2 = performance.now();
    await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
      .select("-questionSnapshots -violations")
      .populate("studentId", "firstName lastName email")
      .populate({
        path: "testId",
        select: "title subjectIds",
        populate: { path: "subjectIds", select: "name" },
      })
      .sort({ submittedAt: -1, updatedAt: -1 })
      .limit(100)
      .lean();
    const timeC2 = performance.now() - tC2;
    console.log(`   Stage C2: TestAttempt.find(100) WITH -questionSnapshots -violations projection: ${timeC2.toFixed(2)} ms`);

    // Stage D: Today attempts count
    const tD = performance.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    await TestAttempt.countDocuments({
      status: { $in: ["SUBMITTED", "EVALUATED"] },
      submittedAt: { $gte: start, $lt: end },
    });
    const timeD = performance.now() - tD;
    console.log(`   Stage D: Today attempts countDocuments: ${timeD.toFixed(2)} ms`);

    // Stage E: Engagement Trend (Summary path)
    const tE = performance.now();
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 6);
    const minimumDateKey = minDate.toISOString().slice(0, 10);
    await Promise.all([
      TestAttempt.find({
        status: { $in: ["SUBMITTED", "EVALUATED"] },
        submittedAt: { $gte: start, $lt: end },
      })
        .select("studentId submittedAt updatedAt createdAt testId")
        .populate({ path: "testId", select: "createdBy isIQRoomTest" })
        .lean(),
      DailyStudentActivity.find({
        organizationId: null,
        dateKey: { $gte: minimumDateKey },
      })
        .select("studentId dateKey sourceCategory")
        .lean(),
    ]);
    const timeE = performance.now() - tE;
    console.log(`   Stage E: Engagement trend queries (today attempts + DailyStudentActivity): ${timeE.toFixed(2)} ms`);

    // Stage F: Test Series & Aggregation
    const tF = performance.now();
    const series = await TestSeries.find({})
      .select("title tests")
      .sort({ createdAt: -1 })
      .lean();
    await TestSeriesAssignment.aggregate([
      {
        $match: {
          seriesId: { $in: series.map((item) => item._id) },
          status: "ACCEPTED",
        },
      },
      { $group: { _id: "$seriesId", students: { $sum: 1 } } },
    ]);
    const timeF = performance.now() - tF;
    console.log(`   Stage F: TestSeries find + TestSeriesAssignment aggregate: ${timeF.toFixed(2)} ms`);

    console.log("\n==================================================================");
    console.log("ADMIN DASHBOARD PROFILING COMPLETE");
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Profiling error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

profileAdminDashboard();
