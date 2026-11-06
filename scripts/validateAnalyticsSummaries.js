import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import Test from "../src/models/test.model.js";
import Question from "../src/models/question.model.js";
import Subject from "../src/models/subject.model.js";
import User from "../src/models/user.model.js";
import AnalyticsProcessingRecord from "../src/models/analyticsProcessingRecord.model.js";
import DailyStudentActivity from "../src/models/dailyStudentActivity.model.js";
import PlatformDailySummary from "../src/models/platformDailySummary.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import { resolveAttemptAnalyticsMetadata } from "../src/services/analyticsSummary.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function runValidation() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for validation.");

  const results = {
    backfillCompleted: { passed: false, details: {} },
    noDuplicateContributions: { passed: false, details: {} },
    attemptCountsMatch: { passed: false, details: {} },
    scoresAndAveragesMatch: { passed: false, details: {} },
    activeStudentsMatch: { passed: false, details: {} },
    studentPerformanceMatches: { passed: false, details: {} },
  };

  try {
    // ---------------------------------------------------------
    // 1. Backfill completed check
    // ---------------------------------------------------------
    const eligibleQuery = { status: { $in: ["SUBMITTED", "EVALUATED"] } };
    const totalEligibleAttempts = await TestAttempt.countDocuments(eligibleQuery);
    const totalProcessedRecords = await AnalyticsProcessingRecord.countDocuments({ status: "PROCESSED" });
    const failedProcessingRecords = await AnalyticsProcessingRecord.countDocuments({ status: { $ne: "PROCESSED" } });

    results.backfillCompleted.passed =
      totalEligibleAttempts === totalProcessedRecords &&
      failedProcessingRecords === 0 &&
      totalEligibleAttempts > 0;

    results.backfillCompleted.details = {
      totalEligibleAttempts,
      totalProcessedRecords,
      failedProcessingRecords,
      status: results.backfillCompleted.passed ? "PASS" : "FAIL"
    };

    // ---------------------------------------------------------
    // 2. No duplicate contributions
    // ---------------------------------------------------------
    // In PlatformDailySummary for organizationId = null:
    const platformSummaries = await PlatformDailySummary.find({ organizationId: null }).lean();
    const sumPlatformDailyAttempts = platformSummaries.reduce((acc, s) => acc + (s.totalAttempts || 0), 0);

    // In StudentPerformanceSummary:
    const studentSummaries = await StudentPerformanceSummary.find().lean();
    const sumStudentSummaryAttempts = studentSummaries.reduce((acc, s) => acc + (s.totalTestsAttempted || 0), 0);

    const noDuplicates =
      sumPlatformDailyAttempts === totalEligibleAttempts &&
      sumStudentSummaryAttempts === totalEligibleAttempts;

    results.noDuplicateContributions.passed = noDuplicates;
    results.noDuplicateContributions.details = {
      totalEligibleAttempts,
      sumPlatformDailyAttempts,
      sumStudentSummaryAttempts,
      status: noDuplicates ? "PASS" : "FAIL"
    };

    // ---------------------------------------------------------
    // 3. Attempt counts match (by dateKey and scope)
    // ---------------------------------------------------------
    const allEligibleAttempts = await TestAttempt.find(eligibleQuery)
      .select("_id studentId testId submittedAt updatedAt createdAt totalScore percentage timeTakenSeconds correctAnswersCount incorrectAnswersCount unattemptedCount answers questionSnapshots")
      .lean();

    // Group raw attempts by dateKey
    const rawAttemptsByDate = new Map();
    for (const a of allEligibleAttempts) {
      const d = new Date(a.submittedAt || a.updatedAt || a.createdAt);
      const dateKey = d.toISOString().slice(0, 10);
      rawAttemptsByDate.set(dateKey, (rawAttemptsByDate.get(dateKey) || 0) + 1);
    }

    let dateCountMismatches = 0;
    const dateComparison = [];
    for (const s of platformSummaries) {
      const rawCount = rawAttemptsByDate.get(s.dateKey) || 0;
      if (rawCount !== s.totalAttempts) {
        dateCountMismatches++;
        dateComparison.push({ dateKey: s.dateKey, rawCount, summaryCount: s.totalAttempts, match: false });
      }
    }

    // Check if any date in raw is missing in summary
    for (const [dateKey, count] of rawAttemptsByDate.entries()) {
      const found = platformSummaries.find(s => s.dateKey === dateKey);
      if (!found) {
        dateCountMismatches++;
        dateComparison.push({ dateKey, rawCount: count, summaryCount: 0, match: false });
      }
    }

    results.attemptCountsMatch.passed = dateCountMismatches === 0;
    results.attemptCountsMatch.details = {
      totalDatesEvaluated: platformSummaries.length,
      dateCountMismatches,
      mismatchSamples: dateComparison.slice(0, 5),
      status: dateCountMismatches === 0 ? "PASS" : "FAIL"
    };

    // ---------------------------------------------------------
    // 4. Scores and averages match
    // ---------------------------------------------------------
    const rawTotalPercentageSum = allEligibleAttempts.reduce(
      (acc, a) => acc + (Number.isFinite(a.percentage) ? a.percentage : 0),
      0
    );
    const summaryPlatformPercentageSum = platformSummaries.reduce(
      (acc, s) => acc + (s.scoreSum || 0),
      0
    );

    const rawTotalScoreSum = allEligibleAttempts.reduce(
      (acc, a) => acc + (Number.isFinite(a.totalScore) ? a.totalScore : 0),
      0
    );
    const summaryStudentScoreSum = studentSummaries.reduce(
      (acc, s) => acc + (s.totalScoreSum || 0),
      0
    );
    const summaryStudentPercentageSum = studentSummaries.reduce(
      (acc, s) => acc + (s.totalPercentageSum || 0),
      0
    );

    const scoreDiff = Math.abs(rawTotalPercentageSum - summaryPlatformPercentageSum);
    const studentScoreDiff = Math.abs(rawTotalScoreSum - summaryStudentScoreSum);
    const studentPercDiff = Math.abs(rawTotalPercentageSum - summaryStudentPercentageSum);

    const scoresMatch = scoreDiff < 0.001 && studentScoreDiff < 0.001 && studentPercDiff < 0.001;

    const rawAvgPercentage = rawTotalPercentageSum / totalEligibleAttempts;
    const summaryPlatformAvgPercentage = summaryPlatformPercentageSum / sumPlatformDailyAttempts;

    results.scoresAndAveragesMatch.passed = scoresMatch;
    results.scoresAndAveragesMatch.details = {
      rawTotalPercentageSum: Number(rawTotalPercentageSum.toFixed(2)),
      summaryPlatformPercentageSum: Number(summaryPlatformPercentageSum.toFixed(2)),
      rawAvgPercentage: Number(rawAvgPercentage.toFixed(2)),
      summaryPlatformAvgPercentage: Number(summaryPlatformAvgPercentage.toFixed(2)),
      rawTotalScoreSum: Number(rawTotalScoreSum.toFixed(2)),
      summaryStudentScoreSum: Number(summaryStudentScoreSum.toFixed(2)),
      status: scoresMatch ? "PASS" : "FAIL"
    };

    // ---------------------------------------------------------
    // 5. Active students match
    // ---------------------------------------------------------
    // Group distinct students per day
    const rawActiveStudentsByDate = new Map();
    for (const a of allEligibleAttempts) {
      const d = new Date(a.submittedAt || a.updatedAt || a.createdAt);
      const dateKey = d.toISOString().slice(0, 10);
      if (!rawActiveStudentsByDate.has(dateKey)) {
        rawActiveStudentsByDate.set(dateKey, new Set());
      }
      rawActiveStudentsByDate.get(dateKey).add(String(a.studentId));
    }

    let activeStudentMismatches = 0;
    const activeStudentComparison = [];
    let daysWithMultipleTestsPerStudent = 0;

    for (const s of platformSummaries) {
      const rawSet = rawActiveStudentsByDate.get(s.dateKey) || new Set();
      const rawCount = rawSet.size;
      const rawTotalAttempts = rawAttemptsByDate.get(s.dateKey) || 0;
      if (rawTotalAttempts > rawCount) {
        daysWithMultipleTestsPerStudent++;
      }
      if (rawCount !== s.activeStudentCount) {
        activeStudentMismatches++;
        activeStudentComparison.push({
          dateKey: s.dateKey,
          rawDistinctStudents: rawCount,
          summaryActiveStudents: s.activeStudentCount,
          rawAttempts: rawTotalAttempts,
          match: false
        });
      }
    }

    // Also check total unique student activity records in DailyStudentActivity
    const distinctDailyActivityCount = await DailyStudentActivity.countDocuments();

    results.activeStudentsMatch.passed = activeStudentMismatches === 0;
    results.activeStudentsMatch.details = {
      totalDatesEvaluated: platformSummaries.length,
      daysWithMultipleTestsPerStudent,
      activeStudentMismatches,
      mismatchSamples: activeStudentComparison.slice(0, 5),
      distinctDailyActivityRecords: distinctDailyActivityCount,
      status: activeStudentMismatches === 0 ? "PASS" : "FAIL"
    };

    // ---------------------------------------------------------
    // 6. Student performance matches (correct, incorrect, skipped, difficulty, time)
    // ---------------------------------------------------------
    const rawTotalCorrect = allEligibleAttempts.reduce((acc, a) => acc + (a.correctAnswersCount || 0), 0);
    const rawTotalIncorrect = allEligibleAttempts.reduce((acc, a) => acc + (a.incorrectAnswersCount || 0), 0);
    const rawTotalUnattempted = allEligibleAttempts.reduce((acc, a) => acc + (a.unattemptedCount || 0), 0);
    const rawTotalTime = allEligibleAttempts.reduce((acc, a) => acc + (a.timeTakenSeconds || 0), 0);

    const summaryTotalCorrect = studentSummaries.reduce((acc, s) => acc + (s.totalCorrectAnswers || 0), 0);
    const summaryTotalIncorrect = studentSummaries.reduce((acc, s) => acc + (s.totalIncorrectAnswers || 0), 0);
    const summaryTotalUnattempted = studentSummaries.reduce((acc, s) => acc + (s.totalUnattemptedQuestions || 0), 0);
    const summaryTotalTime = studentSummaries.reduce((acc, s) => acc + (s.totalTimeSpentSeconds || 0), 0);

    // Sum difficulty breakdown across all student summaries
    const summaryDifficulty = {
      easy: { correct: 0, wrong: 0, skipped: 0 },
      medium: { correct: 0, wrong: 0, skipped: 0 },
      hard: { correct: 0, wrong: 0, skipped: 0 },
    };

    for (const s of studentSummaries) {
      if (s.difficultyBreakdown) {
        for (const diff of ["easy", "medium", "hard"]) {
          summaryDifficulty[diff].correct += s.difficultyBreakdown[diff]?.correct || 0;
          summaryDifficulty[diff].wrong += s.difficultyBreakdown[diff]?.wrong || 0;
          summaryDifficulty[diff].skipped += s.difficultyBreakdown[diff]?.skipped || 0;
        }
      }
    }

    const performanceTotalsMatch =
      rawTotalCorrect === summaryTotalCorrect &&
      rawTotalIncorrect === summaryTotalIncorrect &&
      rawTotalUnattempted === summaryTotalUnattempted &&
      rawTotalTime === summaryTotalTime;

    results.studentPerformanceMatches.passed = performanceTotalsMatch;
    results.studentPerformanceMatches.details = {
      rawTotalCorrect,
      summaryTotalCorrect,
      rawTotalIncorrect,
      summaryTotalIncorrect,
      rawTotalUnattempted,
      summaryTotalUnattempted,
      rawTotalTime,
      summaryTotalTime,
      summaryDifficulty,
      status: performanceTotalsMatch ? "PASS" : "FAIL"
    };

    console.log("=================================================");
    console.log("FINAL VALIDATION REPORT");
    console.log("=================================================");
    console.log(JSON.stringify(results, null, 2));

  } catch (err) {
    console.error("Validation error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

runValidation();
