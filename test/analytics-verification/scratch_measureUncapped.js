import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import "../../src/models/subject.model.js";
import TestAttempt from "../../src/models/testAttempt.model.js";

async function measureUncappedPerformance() {
  await mongoose.connect(process.env.MONGO_URI);

  const start1 = performance.now();
  // 1. All matching attempts with lightweight projection (no studentId populate)
  const allAttempts = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
    .select("submittedAt updatedAt createdAt percentage status resultStatus testId")
    .populate({
      path: "testId",
      select: "subjectIds",
      populate: { path: "subjectIds", select: "name" },
    })
    .sort({ submittedAt: -1 })
    .lean();
  const time1 = (performance.now() - start1).toFixed(2);
  console.log(`[${time1}ms] Fetch all ${allAttempts.length} attempts with subject populate`);

  // 2. Fetch distinct completed testIds
  const start2 = performance.now();
  const distinctIds = await TestAttempt.distinct("testId", { status: { $in: ["SUBMITTED", "EVALUATED"] } });
  const time2 = (performance.now() - start2).toFixed(2);
  console.log(`[${time2}ms] Distinct completed testIds: ${distinctIds.length}`);

  // 3. Top 10 recent tests with full student + test populate
  const start3 = performance.now();
  const top10Recent = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
    .select("studentId testId percentage status resultStatus submittedAt updatedAt createdAt")
    .populate("studentId", "firstName lastName email")
    .populate({
      path: "testId",
      select: "title subjectIds passingPercentage",
      populate: { path: "subjectIds", select: "name" },
    })
    .sort({ submittedAt: -1, _id: -1 })
    .limit(10)
    .lean();
  const time3 = (performance.now() - start3).toFixed(2);
  console.log(`[${time3}ms] Top 10 recent tests with full populate`);

  await mongoose.disconnect();
}

measureUncappedPerformance();
