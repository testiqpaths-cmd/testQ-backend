import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/models/user.model.js";
import Topic from "../src/models/topic.model.js";
import Subject from "../src/models/subject.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function runTests() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Student Dashboard validation.\n");

  try {
    // 1. Find a student who has completed attempts and a summary
    const sampleSummary = await StudentPerformanceSummary.findOne({ totalTestsAttempted: { $gt: 0 } }).lean();
    if (!sampleSummary) {
      console.log("No student summary found.");
      return;
    }
    const studentId = String(sampleSummary.studentId);
    console.log(`Testing with studentId: ${studentId}`);
    console.log(`Summary has: totalTestsAttempted=${sampleSummary.totalTestsAttempted}, totalPercentageSum=${sampleSummary.totalPercentageSum}, scoredAttemptCount=${sampleSummary.scoredAttemptCount}`);

    // Test with USE_ANALYTICS_SUMMARIES = "true"
    process.env.USE_ANALYTICS_SUMMARIES = "true";
    const startOpt = performance.now();
    const optResult = await getStudentDashboardData(studentId);
    const optDuration = (performance.now() - startOpt).toFixed(2);

    // Test with USE_ANALYTICS_SUMMARIES = "false" (Raw Fallback)
    process.env.USE_ANALYTICS_SUMMARIES = "false";
    const startRaw = performance.now();
    const rawResult = await getStudentDashboardData(studentId);
    const rawDuration = (performance.now() - startRaw).toFixed(2);

    console.log("\n=================================================");
    console.log("COMPARISON: Optimized (Summary) vs Raw (Fallback)");
    console.log("=================================================");
    console.log(`Execution Time: Optimized=${optDuration}ms | Raw=${rawDuration}ms`);
    console.log(`totalTestsAttempted: Optimized=${optResult.totalTestsAttempted} | Raw=${rawResult.totalTestsAttempted} | Match=${optResult.totalTestsAttempted === rawResult.totalTestsAttempted}`);
    console.log(`percentageAchieved:  Optimized=${optResult.percentageAchieved} | Raw=${rawResult.percentageAchieved} | Match=${optResult.percentageAchieved === rawResult.percentageAchieved}`);
    console.log(`accuracy:            Optimized=${optResult.accuracy} | Raw=${rawResult.accuracy} | Match=${optResult.accuracy === rawResult.accuracy}`);
    console.log(`subjectWiseTests count: Optimized=${optResult.subjectWiseTests.length} | Raw=${rawResult.subjectWiseTests.length}`);
    console.log(`tests count:         Optimized=${optResult.tests.length} | Raw=${rawResult.tests.length}`);
    console.log(`allTests count:      Optimized=${optResult.allTests.length} | Raw=${rawResult.allTests.length}`);
    console.log(`activeAssignedCount: Optimized=${optResult.activeAssignedTestsCount} | Raw=${rawResult.activeAssignedTestsCount}`);

    // 2. Test student with NO completed attempts
    console.log("\n=================================================");
    console.log("TEST: Student with NO attempts");
    console.log("=================================================");
    const fakeStudentId = new mongoose.Types.ObjectId();
    process.env.USE_ANALYTICS_SUMMARIES = "true";
    const emptyResult = await getStudentDashboardData(fakeStudentId);
    console.log(`Empty Student Result: totalTestsAttempted=${emptyResult.totalTestsAttempted}, percentageAchieved=${emptyResult.percentageAchieved}, accuracy=${emptyResult.accuracy}, tests=${emptyResult.tests.length}, allTests=${emptyResult.allTests.length}`);
    console.log(`Empty check passed: ${emptyResult.totalTestsAttempted === 0 && emptyResult.allTests.length === 0}`);

    // 3. Test student with attempts but NO summary record
    console.log("\n=================================================");
    console.log("TEST: Student with attempts but missing summary (Fallback)");
    console.log("=================================================");
    // Pick another student with attempts
    const otherAttempt = await TestAttempt.findOne({
      studentId: { $ne: new mongoose.Types.ObjectId(studentId) },
      status: { $in: ["SUBMITTED", "EVALUATED"] }
    }).lean();

    if (otherAttempt) {
      const otherStudentId = String(otherAttempt.studentId);
      // Temporarily delete summary for this student if any
      const existingSummary = await StudentPerformanceSummary.findOne({ studentId: otherStudentId }).lean();
      if (existingSummary) {
        await StudentPerformanceSummary.deleteOne({ studentId: otherStudentId });
      }

      process.env.USE_ANALYTICS_SUMMARIES = "true"; // flag enabled, but summary doc missing
      const fallbackResult = await getStudentDashboardData(otherStudentId);
      console.log(`Fallback Student Result: totalTestsAttempted=${fallbackResult.totalTestsAttempted}, percentageAchieved=${fallbackResult.percentageAchieved}, accuracy=${fallbackResult.accuracy}`);
      console.log(`Fallback executed successfully without error: ${fallbackResult.totalTestsAttempted > 0}`);

      // Restore summary if it existed
      if (existingSummary) {
        delete existingSummary._id;
        await StudentPerformanceSummary.create(existingSummary);
      }
    }

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB.");
  }
}

runTests();
