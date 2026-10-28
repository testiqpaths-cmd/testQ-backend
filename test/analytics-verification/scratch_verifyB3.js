import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import AnalyticsProcessingRecord, {
  getAnalyticsRecordState,
} from "../../src/models/analyticsProcessingRecord.model.js";

function runB3Verification() {
  console.log("=== Running Phase B3 Model & Schema Verification Checklist ===\n");
  const results = [];

  // 1. Model imports and initializes successfully
  const modelExists = !!AnalyticsProcessingRecord && typeof AnalyticsProcessingRecord === "function";
  results.push({
    item: "1. Model imports and initializes successfully",
    passed: modelExists,
    details: `AnalyticsProcessingRecord defined: ${modelExists}`,
  });

  // 2. Existing fields and the unique attemptId index remain intact
  const schema = AnalyticsProcessingRecord.schema;
  const paths = Object.keys(schema.paths);
  const hasAttemptId = paths.includes("attemptId");
  const hasStudentId = paths.includes("studentId");
  const hasTestId = paths.includes("testId");
  const hasScore = paths.includes("score");
  const hasPercentage = paths.includes("percentage");
  const hasSubmittedAt = paths.includes("submittedAt");
  const hasProcessedAt = paths.includes("processedAt");

  const indexes = schema.indexes();
  const attemptIndex = indexes.find(
    ([fields, opts]) => fields.attemptId === 1 && opts.unique === true
  );

  results.push({
    item: "2. Existing fields and unique attemptId index remain intact",
    passed: hasAttemptId && hasStudentId && hasTestId && hasScore && hasPercentage && hasSubmittedAt && hasProcessedAt && !!attemptIndex,
    details: `attemptId index unique: ${!!attemptIndex}, attemptId path: ${hasAttemptId}`,
  });

  // 3. Newly constructed version-1 record validates with complete canonical metrics and scope fields
  const validDoc = new AnalyticsProcessingRecord({
    attemptId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    testId: new mongoose.Types.ObjectId(),
    score: 80,
    percentage: 80,
    submittedAt: new Date(),
    processedAt: new Date(),
    metricsVersion: 1,
    canonicalMetrics: {
      correct: 8,
      wrong: 2,
      skipped: 0,
      pending: 0,
      totalQuestions: 10,
      answeredCount: 10,
      evaluatedCount: 10,
      score: 80,
      percentage: 80,
      timeSpentSeconds: 450,
      difficultyBreakdown: {
        easy: { correct: 3, wrong: 0, skipped: 0 },
        medium: { correct: 4, wrong: 1, skipped: 0 },
        hard: { correct: 1, wrong: 1, skipped: 0 },
      },
    },
    subjectKey: "computer_science",
    subjectName: "Computer Science",
    organizationId: new mongoose.Types.ObjectId(),
    dateKey: "2026-10-27",
    sourceCategory: "selfCreated",
  });

  const validationError = validDoc.validateSync();
  const stateValid = getAnalyticsRecordState(validDoc);

  results.push({
    item: "3. Newly constructed version-1 record validates successfully with CANONICAL_BASELINE_AVAILABLE state",
    passed: !validationError && stateValid === "CANONICAL_BASELINE_AVAILABLE",
    details: `validation error: ${validationError ? validationError.message : "none"}, state: ${stateValid}`,
  });

  // 4. A record without metricsVersion is classified as LEGACY_BASELINE_REQUIRED
  const legacyDocNoVersion = new AnalyticsProcessingRecord({
    attemptId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    testId: new mongoose.Types.ObjectId(),
    score: 50,
    percentage: 50,
    submittedAt: new Date(),
  });
  const stateNoVersion = getAnalyticsRecordState(legacyDocNoVersion);
  results.push({
    item: "4. Record without metricsVersion classified as LEGACY_BASELINE_REQUIRED",
    passed: stateNoVersion === "LEGACY_BASELINE_REQUIRED",
    details: `state: ${stateNoVersion}`,
  });

  // 5. A record with metricsVersion: 1 but missing canonicalMetrics is classified as LEGACY_BASELINE_REQUIRED
  const recordMissingMetrics = {
    metricsVersion: 1,
    // canonicalMetrics missing
  };
  const stateMissingMetrics = getAnalyticsRecordState(recordMissingMetrics);
  results.push({
    item: "5. Record with metricsVersion: 1 but missing canonicalMetrics classified as LEGACY_BASELINE_REQUIRED",
    passed: stateMissingMetrics === "LEGACY_BASELINE_REQUIRED",
    details: `state: ${stateMissingMetrics}`,
  });

  // 6. Schema does not silently assign version 1 to old records (metricsVersion is undefined by default)
  const emptyDefaultsDoc = new AnalyticsProcessingRecord({});
  const versionIsUndefined = emptyDefaultsDoc.metricsVersion === undefined;
  const canonicalMetricsIsUndefined = emptyDefaultsDoc.canonicalMetrics === undefined;
  results.push({
    item: "6. Schema does NOT assign default version or metrics to unversioned documents",
    passed: versionIsUndefined && canonicalMetricsIsUndefined,
    details: `metricsVersion: ${emptyDefaultsDoc.metricsVersion}, canonicalMetrics: ${emptyDefaultsDoc.canonicalMetrics}`,
  });

  // 7. Null/undefined record handling in getAnalyticsRecordState returns NEW_RECORD
  const stateNull = getAnalyticsRecordState(null);
  const stateUndefined = getAnalyticsRecordState(undefined);
  results.push({
    item: "7. Null or undefined record classified as NEW_RECORD",
    passed: stateNull === "NEW_RECORD" && stateUndefined === "NEW_RECORD",
    details: `null: ${stateNull}, undefined: ${stateUndefined}`,
  });

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll B3 Checklist Items Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

runB3Verification();
