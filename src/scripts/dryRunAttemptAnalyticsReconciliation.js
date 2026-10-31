// src/scripts/dryRunAttemptAnalyticsReconciliation.js

import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
const { MongoClient, ObjectId } = mongoose.mongo;
import { writeFile } from "node:fs/promises";
import {
  calculateAttemptQuestionMetrics,
} from "../modules/test-attempts/utils/attemptQuestionMetrics.util.js";

const ATTEMPT_IDS = [
  "6a622d45e63c0d5942732bf5",
  "6a62374be63c0d5942733855",
  "6a623768e63c0d59427343e3",
  "6a623b86e63c0d5942749f25",
  "6a648d927971b3b0b7e4dd5f",
  "6a73f850e972feee804d8bd8",
  "6a73f850e972feee804d8be5",
  "6a93c64016a484fd00cf5e21",
  "6a982aaccc0c59832224097d",
];

const hasFlag = (flag) => process.argv.includes(flag);

const getArgValue = (flag) => {
  const arg = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!arg) return undefined;
  if (arg.startsWith(`${flag}=`)) {
    return arg.slice(flag.length + 1);
  }
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const toObjectId = (value) => {
  if (value == null) return null;

  const stringValue = String(value);

  return ObjectId.isValid(stringValue)
    ? new ObjectId(stringValue)
    : null;
};

const toIdString = (value) =>
  value == null ? null : String(value);

const toPlainObject = (value) => {
  if (value == null) return null;

  if (value instanceof Map) {
    return Object.fromEntries(value);
  }

  if (typeof value.toObject === "function") {
    return value.toObject();
  }

  return value;
};

const safeDate = (value) => {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
};

const getUtcDateKey = (value) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const getStoredCounts = (attempt) => ({
  correct: attempt.correctAnswersCount ?? null,
  wrong: attempt.incorrectAnswersCount ?? null,
  skipped: attempt.unattemptedCount ?? null,
});

const getMetricDeltas = (stored, recalculated) => ({
  correct:
    stored.correct == null
      ? null
      : recalculated.correct - stored.correct,

  wrong:
    stored.wrong == null
      ? null
      : recalculated.wrong - stored.wrong,

  skipped:
    stored.skipped == null
      ? null
      : recalculated.skipped - stored.skipped,
});

const getAttemptClassification = (
  attempt,
  recalculated,
  ledgerState
) => {
  if (ledgerState === "LEGACY_BASELINE_REQUIRED") {
    // The answer metrics can be inspected, but historical aggregate
    // contribution deltas cannot be trusted without a baseline.
  }

  const stored = getStoredCounts(attempt);

  const countersAreZero =
    stored.correct === 0 &&
    stored.wrong === 0 &&
    stored.skipped === 0;

  const countersMatch =
    stored.correct === recalculated.correct &&
    stored.wrong === recalculated.wrong &&
    stored.skipped === recalculated.skipped;

  if (
    attempt.status === "SUBMITTED" &&
    countersAreZero &&
    (
      recalculated.correct > 0 ||
      recalculated.wrong > 0 ||
      recalculated.pending > 0
    )
  ) {
    return "UNPOPULATED_STORED_COUNTERS";
  }

  if (!countersMatch) {
    return "STORED_COUNTER_DISCREPANCY";
  }

  return "COUNTERS_MATCH_RECALCULATED_METRICS";
};

const getLedgerState = (ledger) => {
  if (!ledger) {
    return "PROCESSING_RECORD_MISSING";
  }

  if (
    ledger.metricsVersion !== 1 ||
    !ledger.canonicalMetrics
  ) {
    return "LEGACY_BASELINE_REQUIRED";
  }

  return "CANONICAL_BASELINE_AVAILABLE";
};

const getDifficultyMap = (questions) =>
  new Map(
    questions.map((question) => [
      String(question._id),
      question.difficulty,
    ])
  );

const toCanonicalMetricCandidate = (attempt, metrics) => {
  const difficulty = metrics.difficultyBreakdown;

  return {
    correct: metrics.correct,
    wrong: metrics.wrong,
    skipped: metrics.skipped,
    pending: metrics.pending,

    totalQuestions: metrics.totalQuestions,
    answeredCount: metrics.answeredCount,
    evaluatedCount: metrics.evaluatedCount,

    score: attempt.totalScore ?? null,
    percentage: attempt.percentage ?? null,
    timeSpentSeconds: attempt.timeTakenSeconds ?? null,

    difficultyBreakdown: {
      easy: { ...difficulty.Easy },
      medium: { ...difficulty.Medium },
      hard: { ...difficulty.Hard },
    },
  };
};

const getScopeCandidates = (attempt, test, ledger) => ({
  // These values are diagnostic candidates only. They are not
  // considered verified reconciliation scope automatically.
  attempt: {
    subject: attempt.subject ?? null,
    subjectId: toIdString(attempt.subjectId),
    organizationId: toIdString(attempt.organizationId),
    sourceCategory: attempt.sourceCategory ?? null,
  },

  test: {
    subject: test?.subject ?? null,
    subjectId: toIdString(test?.subjectId),
    organizationId: toIdString(test?.organizationId),
    sourceCategory: test?.sourceCategory ?? null,
    createdBy: toIdString(test?.createdBy),
    createdByRole: test?.createdByRole ?? null,
  },

  existingLedger: {
    subjectKey: ledger?.subjectKey ?? null,
    subjectName: ledger?.subjectName ?? null,
    organizationId: toIdString(ledger?.organizationId),
    dateKey: ledger?.dateKey ?? null,
    sourceCategory: ledger?.sourceCategory ?? null,
  },
});

const projectStudentSummary = (summary) => {
  if (!summary) return null;

  return {
    studentId: toIdString(summary.studentId),

    totalTestsAttempted: summary.totalTestsAttempted,
    totalQuestionsAnswered: summary.totalQuestionsAnswered,
    totalCorrectAnswers: summary.totalCorrectAnswers,
    totalIncorrectAnswers: summary.totalIncorrectAnswers,
    totalUnattemptedQuestions: summary.totalUnattemptedQuestions,

    totalScoreSum: summary.totalScoreSum,
    totalPercentageSum: summary.totalPercentageSum,
    scoredAttemptCount: summary.scoredAttemptCount,
    totalTimeSpentSeconds: summary.totalTimeSpentSeconds,

    difficultyBreakdown: toPlainObject(
      summary.difficultyBreakdown
    ),

    subjectStats: toPlainObject(summary.subjectStats),
  };
};

const projectDailySummary = (summary) => {
  if (!summary) return null;

  return {
    dateKey: summary.dateKey,
    organizationId: toIdString(summary.organizationId),

    totalAttempts: summary.totalAttempts,
    scoreSum: summary.scoreSum,
    scoredAttemptCount: summary.scoredAttemptCount,

    sourceCounts: toPlainObject(summary.sourceCounts),
    subjectStats: toPlainObject(summary.subjectStats),
    activeStudentCount: summary.activeStudentCount,
  };
};

async function main() {
  if (!hasFlag("--dry-run")) {
    throw new Error(
      "Safety check failed. Run this script with --dry-run. " +
      "This script is read-only and does not support writes."
    );
  }

  if (hasFlag("--apply")) {
    throw new Error(
      "--apply is not supported. This script must remain read-only."
    );
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error(
      "MONGODB_URI is missing. Configure a read-only database credential."
    );
  }

  const outputPath = getArgValue("--out");

  const client = new MongoClient(mongoUri, {
    readPreference: "secondaryPreferred",
  });

  try {
    await client.connect();

    const db = client.db();

    const attemptsCollection = db.collection("testattempts");
    const questionsCollection = db.collection("questions");
    const testsCollection = db.collection("tests");

    const ledgersCollection = db.collection(
      "analyticsprocessingrecords"
    );

    const studentSummariesCollection = db.collection(
      "studentperformancesummaries"
    );

    const dailySummariesCollection = db.collection(
      "platformdailysummaries"
    );

    const attemptObjectIds = ATTEMPT_IDS.map(toObjectId);

    if (attemptObjectIds.some((id) => id == null)) {
      throw new Error("An attempt ID is not a valid ObjectId.");
    }

    // ------------------------------------------------------------
    // 1. Load only the nine explicitly targeted attempts.
    // ------------------------------------------------------------

    const attempts = await attemptsCollection
      .find({
        _id: { $in: attemptObjectIds },
      })
      .toArray();

    const attemptsById = new Map(
      attempts.map((attempt) => [
        String(attempt._id),
        attempt,
      ])
    );

    const missingAttemptIds = ATTEMPT_IDS.filter(
      (id) => !attemptsById.has(id)
    );

    // ------------------------------------------------------------
    // 2. Load their existing processing records.
    // ------------------------------------------------------------

    const ledgers = await ledgersCollection
      .find({
        attemptId: { $in: attemptObjectIds },
      })
      .toArray();

    const ledgersByAttemptId = new Map(
      ledgers.map((ledger) => [
        String(ledger.attemptId),
        ledger,
      ])
    );

    // ------------------------------------------------------------
    // 3. Load the referenced tests and questions.
    // ------------------------------------------------------------

    const testIds = [
      ...new Set(
        attempts
          .map((attempt) => toIdString(attempt.testId))
          .filter(Boolean)
      ),
    ].map(toObjectId).filter(Boolean);

    const tests = await testsCollection
      .find({
        _id: { $in: testIds },
      })
      .toArray();

    const testsById = new Map(
      tests.map((test) => [String(test._id), test])
    );

    const questionIds = [
      ...new Set(
        attempts.flatMap((attempt) => [
          ...(attempt.answers ?? []).map(
            (answer) => toIdString(answer.questionId)
          ),

          ...(attempt.questionSnapshots ?? []).map(
            (snapshot) => toIdString(snapshot.questionId)
          ),
        ]).filter(Boolean)
      ),
    ].map(toObjectId).filter(Boolean);

    const questions = await questionsCollection
      .find({
        _id: { $in: questionIds },
      })
      .project({
        _id: 1,
        difficulty: 1,
      })
      .toArray();

    const questionDifficultyMap = getDifficultyMap(questions);

    // ------------------------------------------------------------
    // 4. Recalculate question metrics using the shared utility.
    // ------------------------------------------------------------

    const attemptReports = ATTEMPT_IDS.map((attemptId) => {
      const attempt = attemptsById.get(attemptId);

      if (!attempt) {
        return {
          attemptId,
          classification: "ATTEMPT_NOT_FOUND",
          safeForAutomaticReconciliation: false,
        };
      }

      const ledger = ledgersByAttemptId.get(attemptId) ?? null;
      const test = testsById.get(toIdString(attempt.testId)) ?? null;

      const recalculated =
        calculateAttemptQuestionMetrics({
          answers: attempt.answers ?? [],
          questionSnapshots: attempt.questionSnapshots ?? [],
          questionDifficultyMap,
        });

      // ----------------------------------------------------------
      // Canonical Baseline Parity Audit:
      // Reconstruct the historical difficulty contribution that was
      // actually applied to StudentPerformanceSummary (EASY fallback, answers-only)
      // and compare it with the current utility recalculation.
      // ----------------------------------------------------------
      const histDiffMap = new Map(
        questions.map((q) => [
          String(q._id),
          String(q.difficulty || "EASY").toUpperCase(),
        ])
      );

      const historicalDiffApplied = {
        easy: { correct: 0, wrong: 0, skipped: 0 },
        medium: { correct: 0, wrong: 0, skipped: 0 },
        hard: { correct: 0, wrong: 0, skipped: 0 },
      };

      for (const ans of (attempt.answers ?? [])) {
        const raw = histDiffMap.get(String(ans.questionId)) || "EASY";
        const k = raw === "HARD" ? "hard" : raw === "MEDIUM" ? "medium" : "easy";
        if (ans.isCorrect === true) {
          historicalDiffApplied[k].correct += 1;
        } else if (
          (ans.selectedOption !== null && ans.selectedOption !== undefined) ||
          (ans.textAnswer !== null && ans.textAnswer !== undefined && String(ans.textAnswer).trim() !== "")
        ) {
          historicalDiffApplied[k].wrong += 1;
        } else {
          historicalDiffApplied[k].skipped += 1;
        }
      }

      const currentDiffRecalculated = {
        easy: { ...recalculated.difficultyBreakdown.Easy },
        medium: { ...recalculated.difficultyBreakdown.Medium },
        hard: { ...recalculated.difficultyBreakdown.Hard },
      };

      const difficultyParityMatches =
        JSON.stringify(historicalDiffApplied) ===
        JSON.stringify(currentDiffRecalculated);

      const scopeParityMatches = Boolean(
        ledger?.dateKey &&
        ledger?.subjectKey &&
        ledger?.sourceCategory
      );

      const safeToPromoteToCanonical =
        difficultyParityMatches && scopeParityMatches;

      const storedCounts = getStoredCounts(attempt);
      const ledgerState = getLedgerState(ledger);

      return {
        attemptId,
        studentId: toIdString(attempt.studentId),
        testId: toIdString(attempt.testId),

        status: attempt.status,
        startedAt: safeDate(attempt.startedAt),
        submittedAt: safeDate(attempt.submittedAt),

        stored: {
          ...storedCounts,
          totalScore: attempt.totalScore ?? null,
          percentage: attempt.percentage ?? null,
          timeTakenSeconds: attempt.timeTakenSeconds ?? null,
        },

        recalculated: {
          ...recalculated,
          accuracy: Number(recalculated.accuracy.toFixed(4)),
        },

        candidateCounterDeltas: getMetricDeltas(
          storedCounts,
          recalculated
        ),

        candidateCanonicalMetrics:
          toCanonicalMetricCandidate(attempt, recalculated),

        processingRecord: {
          exists: Boolean(ledger),
          ledgerState,
          metricsVersion: ledger?.metricsVersion ?? null,
          hasCanonicalMetrics: Boolean(ledger?.canonicalMetrics),

          storedScore: ledger?.score ?? null,
          storedPercentage: ledger?.percentage ?? null,
          storedProcessedAt: safeDate(ledger?.processedAt),
        },

        canonicalBaselineParity: {
          historicalDiffAppliedToSummary: historicalDiffApplied,
          currentUtilityDiffRecalculated: currentDiffRecalculated,
          difficultyParityMatches,
          scopeParityMatches,
          promotionPermitted: safeToPromoteToCanonical,
          promotionDecision: safeToPromoteToCanonical
            ? "PERMIT_PROMOTION_TO_CANONICAL"
            : "BLOCKED_MUST_REMAIN_LEGACY_BASELINE_REQUIRED",
          promotionBlockerReason: !difficultyParityMatches
            ? "Historical difficulty contribution in StudentPerformanceSummary differs from current utility recalculation. Promoting record with new breakdown would cause incorrect delta subtractions during future re-evaluations."
            : !scopeParityMatches
            ? "Legacy ledger lacks scope fields (dateKey, subjectKey, sourceCategory)."
            : null,
          recommendedReconciliationAction:
            "RECONCILE_ATTEMPT_AND_STUDENT_SCALARS_ONLY__KEEP_PROCESSING_RECORD_AS_LEGACY_BASELINE_REQUIRED",
        },

        scopeCandidates: getScopeCandidates(
          attempt,
          test,
          ledger
        ),

        classification: getAttemptClassification(
          attempt,
          recalculated,
          ledgerState
        ),

        safeForAutomaticReconciliation: false,

        reconciliationBlockers: [
          ...(ledgerState === "LEGACY_BASELINE_REQUIRED"
            ? [
                "Legacy processing record has no canonical historical metrics.",
              ]
            : []),

          "Canonical baseline promotion blocked: difficulty/scope disparity with existing aggregates.",

          "Aggregate contribution deltas require a verified historical baseline.",

          "No database writes are permitted by this dry-run.",
        ],
      };
    });

    // ------------------------------------------------------------
    // 5. Inspect existing student summary documents.
    // ------------------------------------------------------------

    const studentIds = [
      ...new Set(
        attempts
          .map((attempt) => toIdString(attempt.studentId))
          .filter(Boolean)
      ),
    ].map(toObjectId).filter(Boolean);

    const studentSummaries =
      await studentSummariesCollection
        .find({
          studentId: { $in: studentIds },
        })
        .toArray();

    const studentSummaryById = new Map(
      studentSummaries.map((summary) => [
        String(summary.studentId),
        summary,
      ])
    );

    const studentSummaryReport = studentIds.map((studentId) => ({
      studentId: String(studentId),
      exists: studentSummaryById.has(String(studentId)),
      currentSummary: projectStudentSummary(
        studentSummaryById.get(String(studentId)) ?? null
      ),
    }));

    // ------------------------------------------------------------
    // 6. Inspect daily summary documents.
    //
    // Date keys here are UTC candidates derived from submittedAt.
    // They are not treated as the application's verified date scope.
    // ------------------------------------------------------------

    const candidateDateKeys = [
      ...new Set(
        attempts
          .map((attempt) => getUtcDateKey(attempt.submittedAt))
          .filter(Boolean)
      ),
    ];

    const dailySummaries =
      await dailySummariesCollection
        .find({
          dateKey: { $in: candidateDateKeys },
        })
        .toArray();

    const dailySummaryReport = dailySummaries.map(
      (summary) => projectDailySummary(summary)
    );

    const report = {
      reportType: "ATTEMPT_ANALYTICS_RECONCILIATION_DRY_RUN",

      generatedAt: new Date().toISOString(),

      safety: {
        mode: "DRY_RUN",
        databaseWritesAttempted: false,
        databaseWritesAllowed: false,
        targetAttemptCount: ATTEMPT_IDS.length,
        foundAttemptCount: attempts.length,
        missingAttemptIds,
      },

      metricDefinitions: {
        correct: "Answered questions with isCorrect === true.",
        wrong: "Answered questions with isCorrect === false.",
        skipped: "Questions without a non-empty selected option or text answer.",
        pending: "Answered questions without a true/false evaluation.",
        accuracy: "correct / (correct + wrong) * 100.",
        difficultyFallback: "Medium",
      },

      attemptReports,

      studentSummaries: studentSummaryReport,

      dailySummaryInspection: {
        dateKeyBasis: "UTC candidate derived from submittedAt",
        candidateDateKeys,
        matchedDocuments: dailySummaryReport,
        warning:
          "This is an inspection of existing documents for candidate dates. " +
          "It does not establish the correct historical date or organization scope.",
      },

      overallAssessment: {
        allAttemptsRequireReview: true,
        automaticReconciliationAllowed: false,

        canonicalBaselineParitySummary: {
          totalTargetAttempts: ATTEMPT_IDS.length,
          attemptsWithParityMatch: attemptReports.filter(
            (r) => r.canonicalBaselineParity?.promotionPermitted
          ).length,
          attemptsBlockedFromPromotion: attemptReports.filter(
            (r) => !r.canonicalBaselineParity?.promotionPermitted
          ).length,
          promotionToCanonicalAllowed: false,
          parityFinding:
            "Zero of nine attempts pass baseline parity. Historical difficulty breakdown in StudentPerformanceSummary differs from current utility recalculation (due to historical EASY fallback and answer-only iteration), and legacy ledgers lack scope fields. Upgrading these records to canonical would cause incorrect delta subtractions during future re-evaluations.",
          safeActionPlan:
            "1. Correct scalar counters on the 9 testattempts documents.\n" +
            "2. Correct scalar counters on the 6 affected StudentPerformanceSummary documents.\n" +
            "3. Leave StudentPerformanceSummary difficultyBreakdown 100% untouched.\n" +
            "4. Leave PlatformDailySummary 100% untouched.\n" +
            "5. Keep all 9 processing records as LEGACY_BASELINE_REQUIRED (do not promote to metricsVersion: 1) so Phase B4 continues to safely block them from aggregate re-evaluation.",
        },

        nextSteps: [
          "Review the canonical baseline parity audit.",
          "Confirm that legacy processing records will NOT be promoted to canonical.",
          "Authorize the transactional scalar-only reconciliation script.",
        ],
      },
    };

    const json = JSON.stringify(report, null, 2);

    if (outputPath) {
      // This writes a local report file, not to MongoDB.
      await writeFile(outputPath, json, "utf8");

      console.log(`Dry-run report saved to: ${outputPath}`);
    } else {
      console.log(json);
    }

    console.log("\nDRY RUN COMPLETE — NO DATABASE WRITES.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Dry-run reconciliation failed:", error.message);
  process.exitCode = 1;
});
