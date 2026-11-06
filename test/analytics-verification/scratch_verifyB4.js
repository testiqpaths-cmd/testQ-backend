import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import TestAttempt from "../../src/models/testAttempt.model.js";
import Test from "../../src/models/test.model.js";
import Question from "../../src/models/question.model.js";
import Subject from "../../src/models/subject.model.js";
import User from "../../src/models/user.model.js";
import AnalyticsProcessingRecord from "../../src/models/analyticsProcessingRecord.model.js";
import DailyStudentActivity from "../../src/models/dailyStudentActivity.model.js";
import PlatformDailySummary from "../../src/models/platformDailySummary.model.js";
import StudentPerformanceSummary from "../../src/models/studentPerformanceSummary.model.js";

import {
  processCompletedAttemptAnalytics,
  resolveSourceCategory,
  resolveAttemptAnalyticsMetadata,
  ANALYTICS_METRICS_VERSION,
  getCanonicalMetrics,
  normalizeId,
  getCanonicalScope,
  getStoredCanonicalScope,
  areScopesEqual,
  areMetricsEqual,
  subtractMetrics,
} from "../../src/services/analyticsSummary.service.js";

// Helper to construct chainable Mongoose query mocks
const makeQuery = (result) => {
  const query = {
    session: () => query,
    lean: async () => result,
    select: () => query,
    exec: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

async function runB4Verification() {
  console.log("=== Running Phase B4 Analytics Summary & Idempotent Processing Checklist ===\n");
  const results = [];

  // =========================================================================
  // 1. Pure Calculation Helpers: Metrics, Scopes, Equality & Deltas
  // =========================================================================
  try {
    const sampleMetadata = {
      correctAnswersCount: 7,
      incorrectAnswersCount: 2,
      unattemptedQuestionsCount: 1,
      pendingAnswersCount: 0,
      totalQuestionsCount: 10,
      answeredQuestionsCount: 9,
      evaluatedQuestionsCount: 9,
      score: 70,
      percentage: 70,
      timeSpentSeconds: 360,
      diffCounts: {
        easy: { correct: 3, wrong: 0, skipped: 0 },
        medium: { correct: 3, wrong: 1, skipped: 0 },
        hard: { correct: 1, wrong: 1, skipped: 1 },
      },
      subjectKey: "science_101",
      subjectName: "Science",
      organizationId: "org-123",
      dateKey: "2026-10-27",
      sourceCategory: "selfCreated",
    };

    const metricsA = getCanonicalMetrics(sampleMetadata);
    const scopeA = getCanonicalScope(sampleMetadata);

    const metricsMatchSelf = areMetricsEqual(metricsA, { ...metricsA });
    const scopesMatchSelf = areScopesEqual(scopeA, { ...scopeA });

    // Modified scope (different dateKey)
    const scopeDifferentDate = { ...scopeA, dateKey: "2026-10-28" };
    const scopesMatchDifferentDate = areScopesEqual(scopeA, scopeDifferentDate);

    // Modified metrics (different correct/wrong count)
    const metricsDiffAnswers = {
      ...metricsA,
      correct: 6,
      wrong: 3,
    };
    const metricsMatchDiff = areMetricsEqual(metricsA, metricsDiffAnswers);

    const delta = subtractMetrics(metricsDiffAnswers, metricsA);
    const deltaCorrect = delta.correct === -1;
    const deltaWrong = delta.wrong === 1;

    results.push({
      item: "1. Pure calculation helpers: Canonical metrics, scopes, equality and deltas",
      passed:
        metricsMatchSelf &&
        scopesMatchSelf &&
        !scopesMatchDifferentDate &&
        !metricsMatchDiff &&
        deltaCorrect &&
        deltaWrong,
      details: `selfMatch: ${metricsMatchSelf}, dateScopeDiff: ${!scopesMatchDifferentDate}, deltaCorrect: ${delta.correct}, deltaWrong: ${delta.wrong}`,
    });
  } catch (err) {
    results.push({
      item: "1. Pure calculation helpers: Canonical metrics, scopes, equality and deltas",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 2. Negative Deltas & Difficulty Bucket Shifts
  // =========================================================================
  try {
    const baseMetrics = {
      correct: 5,
      wrong: 3,
      skipped: 2,
      pending: 0,
      totalQuestions: 10,
      answeredCount: 8,
      evaluatedCount: 8,
      score: 50,
      percentage: 50,
      timeSpentSeconds: 300,
      difficultyBreakdown: {
        easy: { correct: 3, wrong: 0, skipped: 0 },
        medium: { correct: 2, wrong: 2, skipped: 1 },
        hard: { correct: 0, wrong: 1, skipped: 1 },
      },
    };

    // Answer changed from correct to wrong, moving from easy to hard
    const modifiedMetrics = {
      ...baseMetrics,
      correct: 4, // -1
      wrong: 4,   // +1
      difficultyBreakdown: {
        easy: { correct: 2, wrong: 0, skipped: 0 }, // easy.correct -1
        medium: { correct: 2, wrong: 2, skipped: 1 },
        hard: { correct: 0, wrong: 2, skipped: 1 },  // hard.wrong +1
      },
    };

    const delta = subtractMetrics(modifiedMetrics, baseMetrics);
    const passed =
      delta.correct === -1 &&
      delta.wrong === 1 &&
      delta.difficultyBreakdown.easy.correct === -1 &&
      delta.difficultyBreakdown.hard.wrong === 1 &&
      delta.difficultyBreakdown.medium.correct === 0;

    results.push({
      item: "2. Negative deltas and difficulty bucket shifts calculated accurately",
      passed,
      details: `delta.correct: ${delta.correct}, delta.wrong: ${delta.wrong}, easy.correct delta: ${delta.difficultyBreakdown.easy.correct}, hard.wrong delta: ${delta.difficultyBreakdown.hard.wrong}`,
    });
  } catch (err) {
    results.push({
      item: "2. Negative deltas and difficulty bucket shifts calculated accurately",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // Harness Setup for Model Mocking
  // =========================================================================
  const mockStudentId = new mongoose.Types.ObjectId();
  const mockTestId = new mongoose.Types.ObjectId();
  const mockAttemptId = new mongoose.Types.ObjectId();
  const mockOrgId = new mongoose.Types.ObjectId();
  const mockQuestionId = new mongoose.Types.ObjectId();

  const standardTestDoc = {
    _id: mockTestId,
    title: "Math Diagnostic",
    subjectId: null,
    subjectIds: [],
    type: ["Mathematics"],
    createdBy: { role: "STUDENT", userId: mockStudentId },
    allowedOrganizations: [],
    isIQRoomTest: false,
    marksPerQuestion: 2,
    negativeMarkingPercentage: 0,
  };

  const standardStudentDoc = {
    _id: mockStudentId,
    organizationId: mockOrgId,
  };

  const standardQuestionDocs = [
    { _id: mockQuestionId, difficulty: "Medium" },
  ];

  const standardAttemptDoc = {
    _id: mockAttemptId,
    studentId: mockStudentId,
    testId: mockTestId,
    status: "SUBMITTED",
    totalScore: 80,
    percentage: 80,
    timeTakenSeconds: 400,
    submittedAt: new Date("2026-10-27T10:00:00Z"),
    answers: [
      {
        questionId: mockQuestionId,
        selectedOption: 0,
        isCorrect: true,
      },
    ],
    questionSnapshots: [
      {
        questionId: mockQuestionId,
        difficulty: "Medium",
      },
    ],
  };

  // =========================================================================
  // 3. New Attempt: One contribution per aggregate, ledger has v1 & canonical metrics
  // =========================================================================
  try {
    const writes = {
      dailyStudentActivity: [],
      platformDailySummary: [],
      studentPerformanceSummary: [],
      analyticsProcessingRecord: [],
    };

    // Stubs
    AnalyticsProcessingRecord.findOne = () => makeQuery(null); // No existing record
    AnalyticsProcessingRecord.create = async (docs) => {
      writes.analyticsProcessingRecord.push(...docs);
      return docs;
    };
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    DailyStudentActivity.exists = () => makeQuery(false);
    DailyStudentActivity.updateOne = async (filter, update, opts) => {
      writes.dailyStudentActivity.push({ filter, update, opts });
      return { matchedCount: 1, modifiedCount: 1 };
    };
    PlatformDailySummary.updateOne = async (filter, update, opts) => {
      writes.platformDailySummary.push({ filter, update, opts });
      return { matchedCount: 1, modifiedCount: 1 };
    };
    StudentPerformanceSummary.updateOne = async (filter, update, opts) => {
      writes.studentPerformanceSummary.push({ filter, update, opts });
      return { matchedCount: 1, modifiedCount: 1 };
    };

    const mockSession = { id: "mock-session-1" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const ledgerDoc = writes.analyticsProcessingRecord[0];
    const studentWrite = writes.studentPerformanceSummary[0];

    const passed =
      outcome.success === true &&
      outcome.skipped === false &&
      writes.analyticsProcessingRecord.length === 1 &&
      ledgerDoc.metricsVersion === 1 &&
      ledgerDoc.canonicalMetrics.score === 80 &&
      ledgerDoc.canonicalMetrics.correct === 1 &&
      writes.studentPerformanceSummary.length === 1 &&
      studentWrite.update.$inc.totalTestsAttempted === 1 &&
      studentWrite.update.$inc.totalScoreSum === 80 &&
      studentWrite.update.$inc.totalTimeSpentSeconds === 400 &&
      writes.platformDailySummary.length >= 1;

    results.push({
      item: "3. New attempt: Single contribution per aggregate, ledger saves version 1 and canonical metrics",
      passed,
      details: `success: ${outcome.success}, v1 ledger: ${ledgerDoc?.metricsVersion === 1}, scoreSum: ${studentWrite?.update?.$inc?.totalScoreSum}, time: ${studentWrite?.update?.$inc?.totalTimeSpentSeconds}`,
    });
  } catch (err) {
    results.push({
      item: "3. New attempt: Single contribution per aggregate, ledger saves version 1 and canonical metrics",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 4. Identical Second Processing: ALREADY_PROCESSED_NO_CHANGE, Zero Writes
  // =========================================================================
  try {
    const writes = {
      platformDailySummary: [],
      studentPerformanceSummary: [],
      analyticsProcessingRecordUpdates: [],
    };

    const existingCanonicalRecord = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      metricsVersion: 1,
      canonicalMetrics: {
        correct: 1,
        wrong: 0,
        skipped: 0,
        pending: 0,
        totalQuestions: 1,
        answeredCount: 1,
        evaluatedCount: 1,
        score: 80,
        percentage: 80,
        timeSpentSeconds: 400,
        difficultyBreakdown: {
          easy: { correct: 0, wrong: 0, skipped: 0 },
          medium: { correct: 1, wrong: 0, skipped: 0 },
          hard: { correct: 0, wrong: 0, skipped: 0 },
        },
      },
      subjectKey: "mathematics",
      subjectName: "Mathematics",
      organizationId: String(mockOrgId),
      dateKey: "2026-10-27",
      sourceCategory: "selfCreated",
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(existingCanonicalRecord);
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    PlatformDailySummary.updateOne = async () => writes.platformDailySummary.push(1);
    StudentPerformanceSummary.updateOne = async () => writes.studentPerformanceSummary.push(1);
    AnalyticsProcessingRecord.updateOne = async () => writes.analyticsProcessingRecordUpdates.push(1);

    const mockSession = { id: "mock-session-2" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const passed =
      outcome.success === true &&
      outcome.skipped === true &&
      outcome.reason === "ALREADY_PROCESSED_NO_CHANGE" &&
      writes.platformDailySummary.length === 0 &&
      writes.studentPerformanceSummary.length === 0 &&
      writes.analyticsProcessingRecordUpdates.length === 0;

    results.push({
      item: "4. Identical second processing: Returns ALREADY_PROCESSED_NO_CHANGE with zero aggregate writes",
      passed,
      details: `skipped: ${outcome.skipped}, reason: ${outcome.reason}, writes: ${writes.studentPerformanceSummary.length}`,
    });
  } catch (err) {
    results.push({
      item: "4. Identical second processing: Returns ALREADY_PROCESSED_NO_CHANGE with zero aggregate writes",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 5. Score Unchanged, Correct Count Changed: Deltas Applied to Student & Buckets
  // =========================================================================
  try {
    const writes = {
      studentPerformanceSummary: [],
      analyticsProcessingRecordUpdates: [],
    };

    // Previous record had 0 correct and 1 wrong (score 0)
    const existingRecord = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      metricsVersion: 1,
      canonicalMetrics: {
        correct: 0,
        wrong: 1,
        skipped: 0,
        pending: 0,
        totalQuestions: 1,
        answeredCount: 1,
        evaluatedCount: 1,
        score: 0,
        percentage: 0,
        timeSpentSeconds: 400,
        difficultyBreakdown: {
          easy: { correct: 0, wrong: 0, skipped: 0 },
          medium: { correct: 0, wrong: 1, skipped: 0 },
          hard: { correct: 0, wrong: 0, skipped: 0 },
        },
      },
      subjectKey: "mathematics",
      subjectName: "Mathematics",
      organizationId: String(mockOrgId),
      dateKey: "2026-10-27",
      sourceCategory: "selfCreated",
    };

    // Next evaluation changed to 1 correct, 0 wrong, score still 0 (e.g. ungraded or 0 marks)
    const attemptScoreNeutral = {
      ...standardAttemptDoc,
      totalScore: 0,
      percentage: 0,
      answers: [
        {
          questionId: mockQuestionId,
          selectedOption: 0,
          isCorrect: true, // Now correct
        },
      ],
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(existingRecord);
    TestAttempt.findById = () => makeQuery(attemptScoreNeutral);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    PlatformDailySummary.updateOne = async () => ({ matchedCount: 1 });
    StudentPerformanceSummary.updateOne = async (filter, update) => {
      writes.studentPerformanceSummary.push(update);
      return { matchedCount: 1 };
    };
    AnalyticsProcessingRecord.updateOne = async (filter, update) => {
      writes.analyticsProcessingRecordUpdates.push(update);
      return { matchedCount: 1 };
    };

    const mockSession = { id: "mock-session-3" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const inc = writes.studentPerformanceSummary[0]?.$inc;
    const passed =
      outcome.success === true &&
      outcome.updated === true &&
      outcome.reason === "RE_EVALUATION_APPLIED" &&
      outcome.deltas.correct === 1 &&
      outcome.deltas.wrong === -1 &&
      inc.totalCorrectAnswers === 1 &&
      inc.totalIncorrectAnswers === -1 &&
      inc["difficultyBreakdown.medium.correct"] === 1 &&
      inc["difficultyBreakdown.medium.wrong"] === -1 &&
      writes.analyticsProcessingRecordUpdates.length === 1;

    results.push({
      item: "5. Score unchanged, correct count changed: Metric & difficulty bucket deltas applied",
      passed,
      details: `correctDelta: ${outcome.deltas.correct}, wrongDelta: ${outcome.deltas.wrong}, inc.correct: ${inc?.totalCorrectAnswers}, inc.wrong: ${inc?.totalIncorrectAnswers}`,
    });
  } catch (err) {
    results.push({
      item: "5. Score unchanged, correct count changed: Metric & difficulty bucket deltas applied",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 6. Score Unchanged, Time Changed: Time Delta Applied to Student & Subject
  // =========================================================================
  try {
    const writes = {
      studentPerformanceSummary: [],
    };

    const existingRecord = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      metricsVersion: 1,
      canonicalMetrics: {
        correct: 1,
        wrong: 0,
        skipped: 0,
        pending: 0,
        totalQuestions: 1,
        answeredCount: 1,
        evaluatedCount: 1,
        score: 80,
        percentage: 80,
        timeSpentSeconds: 300, // old: 300s
        difficultyBreakdown: {
          easy: { correct: 0, wrong: 0, skipped: 0 },
          medium: { correct: 1, wrong: 0, skipped: 0 },
          hard: { correct: 0, wrong: 0, skipped: 0 },
        },
      },
      subjectKey: "mathematics",
      subjectName: "Mathematics",
      organizationId: String(mockOrgId),
      dateKey: "2026-10-27",
      sourceCategory: "selfCreated",
    };

    // Next evaluation: time updated to 450s (delta +150s)
    const attemptTimeUpdated = {
      ...standardAttemptDoc,
      timeTakenSeconds: 450,
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(existingRecord);
    TestAttempt.findById = () => makeQuery(attemptTimeUpdated);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    PlatformDailySummary.updateOne = async () => ({ matchedCount: 1 });
    StudentPerformanceSummary.updateOne = async (filter, update) => {
      writes.studentPerformanceSummary.push(update);
      return { matchedCount: 1 };
    };
    AnalyticsProcessingRecord.updateOne = async () => ({ matchedCount: 1 });

    const mockSession = { id: "mock-session-4" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const inc = writes.studentPerformanceSummary[0]?.$inc;
    const passed =
      outcome.success === true &&
      outcome.updated === true &&
      outcome.deltas.timeSpentSeconds === 150 &&
      inc.totalTimeSpentSeconds === 150 &&
      inc["subjectStats.mathematics.timeSpentSeconds"] === 150;

    results.push({
      item: "6. Score unchanged, time changed: Student & subject time deltas applied",
      passed,
      details: `delta: ${outcome.deltas.timeSpentSeconds}s, inc.totalTime: ${inc?.totalTimeSpentSeconds}s, inc.subjectTime: ${inc?.["subjectStats.mathematics.timeSpentSeconds"]}s`,
    });
  } catch (err) {
    results.push({
      item: "6. Score unchanged, time changed: Student & subject time deltas applied",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 7. Percentage Changed: Student & Platform Daily Score Sums Receive Delta
  // =========================================================================
  try {
    const writes = {
      studentPerformanceSummary: [],
      platformDailySummary: [],
    };

    const existingRecord = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      metricsVersion: 1,
      canonicalMetrics: {
        correct: 1,
        wrong: 0,
        skipped: 0,
        pending: 0,
        totalQuestions: 1,
        answeredCount: 1,
        evaluatedCount: 1,
        score: 50,
        percentage: 50, // old 50%
        timeSpentSeconds: 400,
        difficultyBreakdown: {
          easy: { correct: 0, wrong: 0, skipped: 0 },
          medium: { correct: 1, wrong: 0, skipped: 0 },
          hard: { correct: 0, wrong: 0, skipped: 0 },
        },
      },
      subjectKey: "mathematics",
      subjectName: "Mathematics",
      organizationId: String(mockOrgId),
      dateKey: "2026-10-27",
      sourceCategory: "selfCreated",
    };

    // Score changed: 80% (delta = +30)
    const attemptScoreUpdated = {
      ...standardAttemptDoc,
      totalScore: 80,
      percentage: 80,
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(existingRecord);
    TestAttempt.findById = () => makeQuery(attemptScoreUpdated);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    PlatformDailySummary.updateOne = async (filter, update) => {
      writes.platformDailySummary.push({ filter, update });
      return { matchedCount: 1 };
    };
    StudentPerformanceSummary.updateOne = async (filter, update) => {
      writes.studentPerformanceSummary.push({ filter, update });
      return { matchedCount: 1 };
    };
    AnalyticsProcessingRecord.updateOne = async () => ({ matchedCount: 1 });

    const mockSession = { id: "mock-session-5" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const studentInc = writes.studentPerformanceSummary[0]?.update?.$inc;
    const platformInc = writes.platformDailySummary[0]?.update?.$inc;

    const passed =
      outcome.success === true &&
      outcome.updated === true &&
      outcome.deltas.percentage === 30 &&
      studentInc.totalPercentageSum === 30 &&
      studentInc["subjectStats.mathematics.scoreSum"] === 30 &&
      platformInc.scoreSum === 30 &&
      platformInc["subjectStats.mathematics.scoreSum"] === 30;

    results.push({
      item: "7. Percentage changed: Student & Platform Daily score sums receive delta",
      passed,
      details: `delta: ${outcome.deltas.percentage}%, studentScoreSum: ${studentInc?.totalPercentageSum}, platformScoreSum: ${platformInc?.scoreSum}`,
    });
  } catch (err) {
    results.push({
      item: "7. Percentage changed: Student & Platform Daily score sums receive delta",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 8. Legacy Record: Returns LEGACY_BASELINE_REQUIRED, Zero Writes
  // =========================================================================
  try {
    const writes = {
      studentPerformanceSummary: [],
      platformDailySummary: [],
      analyticsProcessingRecord: [],
    };

    // Unversioned legacy record (has score & percentage but no metricsVersion / canonicalMetrics)
    const legacyRecord = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      score: 50,
      percentage: 50,
      submittedAt: new Date(),
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(legacyRecord);
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    PlatformDailySummary.updateOne = async () => writes.platformDailySummary.push(1);
    StudentPerformanceSummary.updateOne = async () => writes.studentPerformanceSummary.push(1);
    AnalyticsProcessingRecord.updateOne = async () => writes.analyticsProcessingRecord.push(1);

    const mockSession = { id: "mock-session-6" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const passed =
      outcome.success === false &&
      outcome.skipped === true &&
      outcome.reason === "LEGACY_BASELINE_REQUIRED" &&
      writes.studentPerformanceSummary.length === 0 &&
      writes.platformDailySummary.length === 0 &&
      writes.analyticsProcessingRecord.length === 0;

    results.push({
      item: "8. Legacy record: Returns LEGACY_BASELINE_REQUIRED with zero writes",
      passed,
      details: `reason: ${outcome.reason}, skipped: ${outcome.skipped}, summary writes: ${writes.studentPerformanceSummary.length}`,
    });
  } catch (err) {
    results.push({
      item: "8. Legacy record: Returns LEGACY_BASELINE_REQUIRED with zero writes",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 9. Changed Date, Subject, Org or Source: SCOPE_MIGRATION_REQUIRES_RECONCILIATION
  // =========================================================================
  try {
    const writes = {
      studentPerformanceSummary: [],
      platformDailySummary: [],
      analyticsProcessingRecord: [],
    };

    // Old scope was yesterday "2026-10-26"
    const existingRecordOldScope = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      metricsVersion: 1,
      canonicalMetrics: {
        correct: 1,
        wrong: 0,
        skipped: 0,
        pending: 0,
        totalQuestions: 1,
        answeredCount: 1,
        evaluatedCount: 1,
        score: 80,
        percentage: 80,
        timeSpentSeconds: 400,
        difficultyBreakdown: {
          easy: { correct: 0, wrong: 0, skipped: 0 },
          medium: { correct: 1, wrong: 0, skipped: 0 },
          hard: { correct: 0, wrong: 0, skipped: 0 },
        },
      },
      subjectKey: "mathematics",
      subjectName: "Mathematics",
      organizationId: String(mockOrgId),
      dateKey: "2026-10-26", // Scope date difference
      sourceCategory: "selfCreated",
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(existingRecordOldScope);
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    PlatformDailySummary.updateOne = async () => writes.platformDailySummary.push(1);
    StudentPerformanceSummary.updateOne = async () => writes.studentPerformanceSummary.push(1);
    AnalyticsProcessingRecord.updateOne = async () => writes.analyticsProcessingRecord.push(1);

    const mockSession = { id: "mock-session-7" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const passed =
      outcome.success === false &&
      outcome.skipped === true &&
      outcome.reason === "SCOPE_MIGRATION_REQUIRES_RECONCILIATION" &&
      outcome.previousScope?.dateKey === "2026-10-26" &&
      outcome.nextScope?.dateKey === "2026-10-27" &&
      writes.studentPerformanceSummary.length === 0 &&
      writes.platformDailySummary.length === 0 &&
      writes.analyticsProcessingRecord.length === 0;

    results.push({
      item: "9. Changed date or scope: Returns SCOPE_MIGRATION_REQUIRES_RECONCILIATION with zero writes",
      passed,
      details: `reason: ${outcome.reason}, prevDate: ${outcome.previousScope?.dateKey}, nextDate: ${outcome.nextScope?.dateKey}`,
    });
  } catch (err) {
    results.push({
      item: "9. Changed date or scope: Returns SCOPE_MIGRATION_REQUIRES_RECONCILIATION with zero writes",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 10. Missing Student Performance Summary on Re-evaluation: Guarded cleanly
  // =========================================================================
  try {
    const writes = {
      analyticsProcessingRecord: [],
    };

    const existingRecord = {
      _id: new mongoose.Types.ObjectId(),
      attemptId: mockAttemptId,
      studentId: mockStudentId,
      testId: mockTestId,
      metricsVersion: 1,
      canonicalMetrics: {
        correct: 0,
        wrong: 1,
        skipped: 0,
        pending: 0,
        totalQuestions: 1,
        answeredCount: 1,
        evaluatedCount: 1,
        score: 0,
        percentage: 0,
        timeSpentSeconds: 400,
        difficultyBreakdown: {
          easy: { correct: 0, wrong: 0, skipped: 0 },
          medium: { correct: 0, wrong: 1, skipped: 0 },
          hard: { correct: 0, wrong: 0, skipped: 0 },
        },
      },
      subjectKey: "mathematics",
      subjectName: "Mathematics",
      organizationId: String(mockOrgId),
      dateKey: "2026-10-27",
      sourceCategory: "selfCreated",
    };

    AnalyticsProcessingRecord.findOne = () => makeQuery(existingRecord);
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    // student summary updateOne returns matchedCount: 0
    StudentPerformanceSummary.updateOne = async () => ({ matchedCount: 0 });
    AnalyticsProcessingRecord.updateOne = async () => writes.analyticsProcessingRecord.push(1);

    const mockSession = { id: "mock-session-8" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const passed =
      outcome.success === false &&
      outcome.skipped === true &&
      outcome.reason === "STUDENT_SUMMARY_MISSING_REQUIRES_RECONCILIATION" &&
      writes.analyticsProcessingRecord.length === 0;

    results.push({
      item: "10. Missing StudentPerformanceSummary on re-evaluation: Flags reconciliation, zero ledger writes",
      passed,
      details: `reason: ${outcome.reason}, ledgerWrites: ${writes.analyticsProcessingRecord.length}`,
    });
  } catch (err) {
    results.push({
      item: "10. Missing StudentPerformanceSummary on re-evaluation: Flags reconciliation, zero ledger writes",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 11. Transaction Error Rollback: Aggregate update failure rolls back
  // =========================================================================
  try {
    AnalyticsProcessingRecord.findOne = () => makeQuery(null);
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    DailyStudentActivity.exists = () => makeQuery(false);
    DailyStudentActivity.updateOne = async () => ({ matchedCount: 1 });
    PlatformDailySummary.updateOne = async () => ({ matchedCount: 1 });
    StudentPerformanceSummary.updateOne = async () => {
      throw new Error("DB_WRITE_FAILURE_DISK_FULL");
    };

    let errorThrown = null;
    const mockSession = { id: "mock-session-9" };
    try {
      await processCompletedAttemptAnalytics(mockAttemptId, {
        session: mockSession,
      });
    } catch (err) {
      errorThrown = err;
    }

    const passed = errorThrown && errorThrown.message === "DB_WRITE_FAILURE_DISK_FULL";

    results.push({
      item: "11. Transaction error handling: Database failure during aggregate write propagates error",
      passed: !!passed,
      details: `error: ${errorThrown?.message}`,
    });
  } catch (err) {
    results.push({
      item: "11. Transaction error handling: Database failure during aggregate write propagates error",
      passed: false,
      details: err.message,
    });
  }

  // =========================================================================
  // 12. Duplicate Concurrent Processing: Catches 11000 duplicate key error
  // =========================================================================
  try {
    AnalyticsProcessingRecord.findOne = () => makeQuery(null);
    TestAttempt.findById = () => makeQuery(standardAttemptDoc);
    Test.findById = () => makeQuery(standardTestDoc);
    User.findById = () => makeQuery(standardStudentDoc);
    Question.find = () => makeQuery(standardQuestionDocs);
    DailyStudentActivity.exists = () => makeQuery(false);
    DailyStudentActivity.updateOne = async () => ({ matchedCount: 1 });
    PlatformDailySummary.updateOne = async () => ({ matchedCount: 1 });
    StudentPerformanceSummary.updateOne = async () => ({ matchedCount: 1 });
    AnalyticsProcessingRecord.create = async () => {
      const err = new Error("E11000 duplicate key error collection");
      err.code = 11000;
      throw err;
    };

    const mockSession = { id: "mock-session-10" };
    const outcome = await processCompletedAttemptAnalytics(mockAttemptId, {
      session: mockSession,
    });

    const passed =
      outcome.success === true &&
      outcome.skipped === true &&
      outcome.reason === "CONCURRENT_DUPLICATE_KEY";

    results.push({
      item: "12. Duplicate concurrent processing: Catches E11000 and returns CONCURRENT_DUPLICATE_KEY",
      passed,
      details: `skipped: ${outcome.skipped}, reason: ${outcome.reason}`,
    });
  } catch (err) {
    results.push({
      item: "12. Duplicate concurrent processing: Catches E11000 and returns CONCURRENT_DUPLICATE_KEY",
      passed: false,
      details: err.message,
    });
  }

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll 12 Checklist Items Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

runB4Verification();
