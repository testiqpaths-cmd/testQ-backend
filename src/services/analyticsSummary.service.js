import mongoose from "mongoose";
import TestAttempt from "../models/testAttempt.model.js";
import Test from "../models/test.model.js";
import Question from "../models/question.model.js";
import Subject from "../models/subject.model.js";
import User from "../models/user.model.js";
import AnalyticsProcessingRecord from "../models/analyticsProcessingRecord.model.js";
import DailyStudentActivity from "../models/dailyStudentActivity.model.js";
import PlatformDailySummary from "../models/platformDailySummary.model.js";
import StudentPerformanceSummary from "../models/studentPerformanceSummary.model.js";

/**
 * Resolves analytics source category matching dashboard convention:
 * - "iqRoom" for IQ Room tests
 * - "selfCreated" for student self-created tests
 * - "organization" for organization-created tests
 * - "admin" for platform admin tests
 */
export const resolveSourceCategory = (test) => {
  if (test?.isIQRoomTest) return "iqRoom";
  const role = test?.createdBy?.role;
  if (role === "STUDENT") return "selfCreated";
  if (role === "ORGANIZATION") return "organization";
  if (role === "IQPATH_ADMIN") return "admin";
  return "selfCreated";
};

/**
 * Resolves metadata and contributions for a test attempt:
 * - Organization scope
 * - Source category
 * - Subject key and name
 * - Question difficulty breakdown
 * - Normalized scores and timings
 */
export const resolveAttemptAnalyticsMetadata = async (attempt, session) => {
  const testQuery = Test.findById(attempt.testId).select(
    "title subjectId subjectIds type createdBy allowedOrganizations isIQRoomTest marksPerQuestion negativeMarkingPercentage"
  );
  if (session) testQuery.session(session);
  const test = await testQuery.lean();

  const studentQuery = User.findById(attempt.studentId).select("organizationId");
  if (session) studentQuery.session(session);
  const student = await studentQuery.lean();

  let creatorOrgId = null;
  if (test?.createdBy?.role === "ORGANIZATION" && test.createdBy.userId) {
    const creatorQuery = User.findById(test.createdBy.userId).select("organizationId");
    if (session) creatorQuery.session(session);
    const creatorUser = await creatorQuery.lean();
    creatorOrgId = creatorUser?.organizationId || null;
  }

  const organizationId =
    (Array.isArray(test?.allowedOrganizations) && test.allowedOrganizations[0]) ||
    creatorOrgId ||
    student?.organizationId ||
    null;

  const sourceCategory = resolveSourceCategory(test);

  // Subject resolution
  const subjectId =
    test?.subjectId ||
    (Array.isArray(test?.subjectIds) && test.subjectIds.length > 0 ? test.subjectIds[0] : null);

  let subjectKey = "general";
  let subjectName = "General";

  if (subjectId) {
    subjectKey = String(subjectId);
    const subjectDocQuery = Subject.findById(subjectId).select("name");
    if (session) subjectDocQuery.session(session);
    const subjectDoc = await subjectDocQuery.lean();
    if (subjectDoc?.name && typeof subjectDoc.name === "string" && subjectDoc.name.trim()) {
      subjectName = subjectDoc.name.trim();
    }
  } else if (Array.isArray(test?.type) && test.type.length > 0 && typeof test.type[0] === "string" && test.type[0].trim()) {
    subjectName = test.type[0].trim();
    subjectKey = subjectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  } else if (typeof test?.type === "string" && test.type.trim()) {
    subjectName = test.type.trim();
    subjectKey = subjectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  }

  // Date resolution (UTC YYYY-MM-DD)
  const attemptDate = new Date(
    attempt.submittedAt || attempt.updatedAt || attempt.createdAt || Date.now()
  );
  const dateKey = attemptDate.toISOString().slice(0, 10);

  // Difficulty analysis by batch-fetching Question documents
  const questionIds = Array.from(
    new Set(
      (attempt.answers || [])
        .map((a) => a.questionId)
        .concat((attempt.questionSnapshots || []).map((s) => s.questionId))
        .filter(Boolean)
        .map((id) => String(id))
    )
  );

  let difficultyMap = new Map();
  if (questionIds.length > 0) {
    const qQuery = Question.find({ _id: { $in: questionIds } }).select("_id difficulty");
    if (session) qQuery.session(session);
    const questions = await qQuery.lean();
    difficultyMap = new Map(
      questions.map((q) => [String(q._id), String(q.difficulty || "EASY").toUpperCase()])
    );
  }

  const diffCounts = {
    easy: { correct: 0, wrong: 0, skipped: 0 },
    medium: { correct: 0, wrong: 0, skipped: 0 },
    hard: { correct: 0, wrong: 0, skipped: 0 },
  };

  const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
  for (const ans of answers) {
    const rawDiff = difficultyMap.get(String(ans.questionId)) || "EASY";
    const bucketKey =
      rawDiff === "HARD" ? "hard" : rawDiff === "MEDIUM" ? "medium" : "easy";

    if (ans.isCorrect === true) {
      diffCounts[bucketKey].correct += 1;
    } else if (
      (ans.selectedOption !== null && ans.selectedOption !== undefined) ||
      (ans.textAnswer !== null && ans.textAnswer !== undefined && String(ans.textAnswer).trim() !== "")
    ) {
      diffCounts[bucketKey].wrong += 1;
    } else {
      diffCounts[bucketKey].skipped += 1;
    }
  }

  const score = Number.isFinite(attempt.totalScore) ? attempt.totalScore : 0;
  const percentage = Number.isFinite(attempt.percentage) ? attempt.percentage : 0;
  const timeSpentSeconds = Number.isFinite(attempt.timeTakenSeconds)
    ? attempt.timeTakenSeconds
    : 0;

  return {
    test,
    student,
    organizationId,
    sourceCategory,
    subjectKey,
    subjectName,
    dateKey,
    attemptDate,
    diffCounts,
    score,
    percentage,
    timeSpentSeconds,
  };
};

/**
 * Atomically records the completed attempt's contribution to:
 * 1. AnalyticsProcessingRecord (idempotency ledger)
 * 2. DailyStudentActivity (deduplicated daily active student ledger)
 * 3. PlatformDailySummary (platform-wide and organization-scoped)
 * 4. StudentPerformanceSummary (per-student cumulative performance)
 *
 * All operations execute within a MongoDB multi-document transaction.
 *
 * @param {string|mongoose.Types.ObjectId} attemptId
 * @param {Object} [options]
 * @param {mongoose.ClientSession} [options.session]
 * @returns {Promise<{ success: boolean, attemptId: any, skipped?: boolean, reason?: string }>}
 */
export const processCompletedAttemptAnalytics = async (attemptId, options = {}) => {
  const existingSession = options.session;
  const session = existingSession || (await mongoose.startSession());
  let outcome = { success: true, attemptId, skipped: false };

  try {
    const executeWithinTransaction = async (txSession) => {
      // 1. Existing processing record check
      const existingRecord = await AnalyticsProcessingRecord.findOne({ attemptId })
        .session(txSession)
        .lean();

      // 2. Attempt eligibility check
      const attempt = await TestAttempt.findById(attemptId).session(txSession).lean();
      if (!attempt) {
        return { success: false, attemptId, skipped: false, reason: "ATTEMPT_NOT_FOUND" };
      }

      if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED") {
        return {
          success: false,
          attemptId,
          skipped: true,
          reason: `INELIGIBLE_STATUS_${attempt.status}`,
        };
      }

      // 3. Resolve metadata and contributions
      const metadata = await resolveAttemptAnalyticsMetadata(attempt, txSession);
      const {
        organizationId,
        sourceCategory,
        subjectKey,
        subjectName,
        dateKey,
        attemptDate,
        diffCounts,
        score,
        percentage,
        timeSpentSeconds,
      } = metadata;

      // 1b. Check if already processed: handle re-evaluation score delta or skip if identical
      if (existingRecord) {
        const scoreDelta = score - (existingRecord.score || 0);
        const percentageDelta = percentage - (existingRecord.percentage || 0);

        if (scoreDelta === 0 && percentageDelta === 0) {
          return { success: true, attemptId, skipped: true, reason: "ALREADY_PROCESSED_NO_CHANGE" };
        }

        // Apply delta update to StudentPerformanceSummary
        await StudentPerformanceSummary.updateOne(
          { studentId: attempt.studentId },
          {
            $inc: {
              totalScoreSum: scoreDelta,
              totalPercentageSum: percentageDelta,
              [`subjectStats.${subjectKey}.scoreSum`]: percentageDelta,
            },
          },
          { session: txSession }
        );

        // Apply delta update to PlatformDailySummary (platform-wide)
        await PlatformDailySummary.updateOne(
          { dateKey, organizationId: null },
          {
            $inc: {
              scoreSum: percentageDelta,
              [`subjectStats.${subjectKey}.scoreSum`]: percentageDelta,
            },
          },
          { session: txSession }
        );

        // Apply delta update to PlatformDailySummary (organization scope, if applicable)
        if (organizationId) {
          await PlatformDailySummary.updateOne(
            { dateKey, organizationId },
            {
              $inc: {
                scoreSum: percentageDelta,
                [`subjectStats.${subjectKey}.scoreSum`]: percentageDelta,
              },
            },
            { session: txSession }
          );
        }

        // Update the processing ledger with the latest scores
        await AnalyticsProcessingRecord.updateOne(
          { _id: existingRecord._id },
          {
            $set: {
              score,
              percentage,
              processedAt: new Date(),
            },
          },
          { session: txSession }
        );

        return {
          success: true,
          attemptId,
          updated: true,
          reason: "RE_EVALUATION_APPLIED",
          deltas: { scoreDelta, percentageDelta },
        };
      }

      const scopeOrgId = organizationId || null;

      // 4. Daily Active Student Tracking (Atomic Deduplication)
      // Check whether this student was already active today in this scope
      const alreadyActiveForScope = await DailyStudentActivity.exists({
        dateKey,
        studentId: attempt.studentId,
        organizationId: scopeOrgId,
      }).session(txSession);

      // Check whether this student was already active today across the entire platform
      const alreadyActivePlatform = await DailyStudentActivity.exists({
        dateKey,
        studentId: attempt.studentId,
      }).session(txSession);

      // Upsert DailyStudentActivity record for (dateKey, studentId, sourceCategory, organizationId)
      await DailyStudentActivity.updateOne(
        {
          dateKey,
          studentId: attempt.studentId,
          sourceCategory,
          organizationId: scopeOrgId,
        },
        {
          $setOnInsert: {
            dateKey,
            studentId: attempt.studentId,
            sourceCategory,
            organizationId: scopeOrgId,
          },
        },
        { upsert: true, session: txSession }
      );

      // 5. Update PlatformDailySummary (Platform-wide: organizationId = null)
      const platformInc = {
        totalAttempts: 1,
        scoreSum: percentage,
        scoredAttemptCount: 1,
        [`sourceCounts.${sourceCategory}`]: 1,
        [`subjectStats.${subjectKey}.attemptCount`]: 1,
        [`subjectStats.${subjectKey}.scoreSum`]: percentage,
        [`subjectStats.${subjectKey}.scoredAttemptCount`]: 1,
      };

      if (!alreadyActivePlatform) {
        platformInc.activeStudentCount = 1;
      }

      await PlatformDailySummary.updateOne(
        { dateKey, organizationId: null },
        {
          $inc: platformInc,
          $set: {
            [`subjectStats.${subjectKey}.subjectName`]: subjectName,
          },
        },
        { upsert: true, session: txSession }
      );

      // 6. Update PlatformDailySummary (Organization-scoped, if applicable)
      if (organizationId) {
        const orgInc = {
          totalAttempts: 1,
          scoreSum: percentage,
          scoredAttemptCount: 1,
          [`sourceCounts.${sourceCategory}`]: 1,
          [`subjectStats.${subjectKey}.attemptCount`]: 1,
          [`subjectStats.${subjectKey}.scoreSum`]: percentage,
          [`subjectStats.${subjectKey}.scoredAttemptCount`]: 1,
        };

        if (!alreadyActiveForScope) {
          orgInc.activeStudentCount = 1;
        }

        await PlatformDailySummary.updateOne(
          { dateKey, organizationId },
          {
            $inc: orgInc,
            $set: {
              [`subjectStats.${subjectKey}.subjectName`]: subjectName,
            },
          },
          { upsert: true, session: txSession }
        );
      }

      // 7. Update StudentPerformanceSummary
      const studentInc = {
        totalTestsAttempted: 1,
        totalQuestionsAnswered:
          (attempt.correctAnswersCount || 0) + (attempt.incorrectAnswersCount || 0),
        totalCorrectAnswers: attempt.correctAnswersCount || 0,
        totalIncorrectAnswers: attempt.incorrectAnswersCount || 0,
        totalUnattemptedQuestions: attempt.unattemptedCount || 0,
        totalScoreSum: score,
        totalPercentageSum: percentage,
        scoredAttemptCount: 1,
        totalTimeSpentSeconds: timeSpentSeconds,

        "difficultyBreakdown.easy.correct": diffCounts.easy.correct,
        "difficultyBreakdown.easy.wrong": diffCounts.easy.wrong,
        "difficultyBreakdown.easy.skipped": diffCounts.easy.skipped,

        "difficultyBreakdown.medium.correct": diffCounts.medium.correct,
        "difficultyBreakdown.medium.wrong": diffCounts.medium.wrong,
        "difficultyBreakdown.medium.skipped": diffCounts.medium.skipped,

        "difficultyBreakdown.hard.correct": diffCounts.hard.correct,
        "difficultyBreakdown.hard.wrong": diffCounts.hard.wrong,
        "difficultyBreakdown.hard.skipped": diffCounts.hard.skipped,

        [`subjectStats.${subjectKey}.attemptCount`]: 1,
        [`subjectStats.${subjectKey}.scoreSum`]: percentage,
        [`subjectStats.${subjectKey}.scoredAttemptCount`]: 1,
        [`subjectStats.${subjectKey}.timeSpentSeconds`]: timeSpentSeconds,
      };

      await StudentPerformanceSummary.updateOne(
        { studentId: attempt.studentId },
        { $inc: studentInc },
        { upsert: true, session: txSession }
      );

      // 8. Record in AnalyticsProcessingRecord ledger
      await AnalyticsProcessingRecord.create(
        [
          {
            attemptId: attempt._id,
            studentId: attempt.studentId,
            testId: attempt.testId,
            status: "PROCESSED",
            score,
            percentage,
            submittedAt: attemptDate,
            processedAt: new Date(),
          },
        ],
        { session: txSession }
      );

      return { success: true, attemptId, skipped: false };
    };

    if (existingSession) {
      outcome = await executeWithinTransaction(session);
    } else {
      await session.withTransaction(async () => {
        outcome = await executeWithinTransaction(session);
      });
    }
  } catch (err) {
    if (err.code === 11000) {
      return {
        success: true,
        attemptId,
        skipped: true,
        reason: "CONCURRENT_DUPLICATE_KEY",
      };
    }
    throw err;
  } finally {
    if (!existingSession) {
      await session.endSession();
    }
  }

  return outcome;
};

export default {
  resolveSourceCategory,
  resolveAttemptAnalyticsMetadata,
  processCompletedAttemptAnalytics,
};
