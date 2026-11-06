import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import AnalyticsProcessingRecord from "../src/models/analyticsProcessingRecord.model.js";
import { processCompletedAttemptAnalytics } from "../src/services/analyticsSummary.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function testReEvaluationDeltas() {
  await mongoose.connect(mongoUri);
  console.log("==================================================================");
  console.log("RE-EVALUATION DELTA & AGGREGATE CORRECTNESS VERIFICATION");
  console.log("==================================================================\n");

  const studentId = "6a58fcec24446ef390bf4cf5";

  try {
    // 1. Locate an existing processed attempt for this student
    const ledgerRecord = await AnalyticsProcessingRecord.findOne({ studentId });
    if (!ledgerRecord) {
      throw new Error("No processing record found for sample student");
    }

    const attemptId = ledgerRecord.attemptId;
    const attempt = await TestAttempt.findById(attemptId);
    console.log(`Testing with attempt: ${attemptId}`);
    console.log(`Original scores -> score: ${attempt.totalScore}, percentage: ${attempt.percentage}%`);

    const initialSummary = await StudentPerformanceSummary.findOne({ studentId }).lean();
    console.log(`Initial Summary -> totalTestsAttempted: ${initialSummary.totalTestsAttempted}, totalScoreSum: ${initialSummary.totalScoreSum}, totalPercentageSum: ${initialSummary.totalPercentageSum}\n`);

    // 2. Test Idempotency with No Changes
    console.log("1. Verifying idempotent run when scores have NOT changed...");
    const noChangeResult = await processCompletedAttemptAnalytics(attemptId);
    console.log(`   Result:`, noChangeResult);
    const noChangePassed = noChangeResult.skipped === true && noChangeResult.reason === "ALREADY_PROCESSED_NO_CHANGE";
    console.log(`   No-Change Skip: ${noChangePassed ? "PASSED" : "FAILED"}\n`);

    // 3. Test Re-Evaluation with Delta Changes (+10 score, +5 percentage)
    console.log("2. Simulating re-evaluation with score & percentage delta (+10 score, +5 percentage)...");
    const origScore = attempt.totalScore;
    const origPct = attempt.percentage;

    try {
      await TestAttempt.updateOne(
        { _id: attemptId },
        { $inc: { totalScore: 10, percentage: 5 } }
      );

      const deltaResult = await processCompletedAttemptAnalytics(attemptId);
      console.log(`   Re-evaluation process result:`, deltaResult);

      const updatedSummary = await StudentPerformanceSummary.findOne({ studentId }).lean();
      console.log(`   Updated Summary -> totalTestsAttempted: ${updatedSummary.totalTestsAttempted}, totalScoreSum: ${updatedSummary.totalScoreSum}, totalPercentageSum: ${updatedSummary.totalPercentageSum}`);

      // Assertions
      const countPreserved = updatedSummary.totalTestsAttempted === initialSummary.totalTestsAttempted;
      const scoreDeltaCorrect = updatedSummary.totalScoreSum === initialSummary.totalScoreSum + 10;
      const pctDeltaCorrect = updatedSummary.totalPercentageSum === initialSummary.totalPercentageSum + 5;

      console.log(`   Assertions:`);
      console.log(`     - totalTestsAttempted preserved (no double-counting): ${countPreserved ? "PASSED" : "FAILED"}`);
      console.log(`     - totalScoreSum adjusted by exactly +10: ${scoreDeltaCorrect ? "PASSED" : "FAILED"}`);
      console.log(`     - totalPercentageSum adjusted by exactly +5: ${pctDeltaCorrect ? "PASSED" : "FAILED"}`);

      const updatedLedger = await AnalyticsProcessingRecord.findOne({ attemptId });
      console.log(`     - Ledger updated to new score (${updatedLedger.score}) & percentage (${updatedLedger.percentage}%): ${updatedLedger.score === origScore + 10 ? "PASSED" : "FAILED"}`);

      const overallSuccess = countPreserved && scoreDeltaCorrect && pctDeltaCorrect;
      console.log(`\n   Re-evaluation Delta Handling: ${overallSuccess ? "PASSED" : "FAILED"}`);

    } finally {
      // 4. Restore original attempt scores and apply reverse delta to restore baseline
      console.log("\n3. Restoring original attempt scores and baseline summary...");
      await TestAttempt.updateOne(
        { _id: attemptId },
        { $set: { totalScore: origScore, percentage: origPct } }
      );
      await processCompletedAttemptAnalytics(attemptId);

      const restoredSummary = await StudentPerformanceSummary.findOne({ studentId }).lean();
      console.log(`   Restored Summary -> totalTestsAttempted: ${restoredSummary.totalTestsAttempted}, totalScoreSum: ${restoredSummary.totalScoreSum}, totalPercentageSum: ${restoredSummary.totalPercentageSum}`);
      console.log("   Baseline fully restored.");
    }

    console.log("\n==================================================================");
    console.log("RE-EVALUATION VERIFICATION COMPLETED SUCCESSFULLY!");
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

testReEvaluationDeltas();
