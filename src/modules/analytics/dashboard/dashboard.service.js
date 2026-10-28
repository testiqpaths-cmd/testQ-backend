import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";
import User from "../../auth/models/User.model.js";
import Organization from "../../../models/organization.model.js";
import Test from "../../../models/test.model.js";
import TestAssignment from "../../../models/testAssignment.model.js";
import TestSeries from "../../../models/testSeries.model.js";
import TestSeriesAssignment from "../../../models/testSeriesAssignment.model.js";
import Question from "../../../models/question.model.js";
import HelpSupport from "../../help-support/helpSupport.model.js";
import UserSubscription from "../../subscription/models/UserSubscription.model.js";
import StudentPerformanceSummary from "../../../models/studentPerformanceSummary.model.js";
import DailyStudentActivity from "../../../models/dailyStudentActivity.model.js";
import { isValidSnapshot } from "../../test-attempts/utils/attemptAnalyticsSnapshot.util.js";
import {
  recordDashboardRequest,
  recordSnapshotFallback,
  recordAnalyticsDiscrepancy,
} from "./dashboardTelemetry.js";
import { getIsoWeekDetails, getWeekNumber } from "../utils/date.js";

export { getIsoWeekDetails, getWeekNumber };
export const isAnalyticsSummariesEnabled = () => process.env.USE_ANALYTICS_SUMMARIES !== "false";
export const isSummaryEngagementTrendEnabled = () => process.env.USE_SUMMARY_ENGAGEMENT_TREND !== "false";
export const isAnalyticsSnapshotsEnabled = () => process.env.USE_ANALYTICS_SNAPSHOTS !== "false";


const DIFFICULTY_LABELS = ["Easy", "Medium", "Hard"];

const toDifficultyLabel = (value) => {
  const normalized = String(value || "MEDIUM").toLowerCase();
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return DIFFICULTY_LABELS.includes(label) ? label : "Medium";
};

const emptyDifficultyBreakdown = () => ({
  Easy: { correct: 0, wrong: 0, skipped: 0 },
  Medium: { correct: 0, wrong: 0, skipped: 0 },
  Hard: { correct: 0, wrong: 0, skipped: 0 },
});

const answerHasValue = (answer) => {
  const hasSelectedOption =
    answer?.selectedOption !== undefined &&
    answer?.selectedOption !== null &&
    String(answer.selectedOption).trim() !== "";

  const hasTextAnswer =
    answer?.textAnswer !== undefined &&
    answer?.textAnswer !== null &&
    String(answer.textAnswer).trim() !== "";

  return hasSelectedOption || hasTextAnswer;
};

const getPassingThreshold = (test) =>
  typeof test?.passingPercentage === "number"
    ? test.passingPercentage
    : 50;

const getActualTimeTakenSeconds = (attempt) => {
  const recordedSeconds = Number(attempt.timeTakenSeconds);

  if (
    attempt.timeTakenSeconds !== null &&
    attempt.timeTakenSeconds !== undefined &&
    attempt.timeTakenSeconds !== "" &&
    Number.isFinite(recordedSeconds) &&
    recordedSeconds >= 0
  ) {
    return recordedSeconds;
  }

  const startedAt = new Date(attempt.startedAt).getTime();
  const submittedAt = new Date(attempt.submittedAt).getTime();

  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(submittedAt) ||
    startedAt <= 0 ||
    submittedAt < startedAt
  ) {
    return 0;
  }

  const elapsedSeconds = Math.floor((submittedAt - startedAt) / 1000);
  const durationMinutes = Number(attempt.duration);

  // The TestAttempt schema stores duration in minutes.
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return Math.min(elapsedSeconds, durationMinutes * 60);
  }

  return elapsedSeconds;
};

const formatDuration = (seconds) => {
  const value = Number(seconds);

  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }

  const minutes = Math.floor(value / 60);
  const remainingSeconds = Math.floor(value % 60);

  if (minutes === 0) return `${remainingSeconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;

  return `${minutes}m ${remainingSeconds}s`;
};

export const getAttemptResultStatus = (attempt, percentage, test) => {
  if (!attempt) return "unknown";

  // Prefer the persisted result when one exists.
  const resStatus = String(attempt.resultStatus || "").toUpperCase();
  if (resStatus === "PASS" || resStatus === "PASSED") return "pass";
  if (resStatus === "FAIL" || resStatus === "FAILED") return "fail";

  // An attempt awaiting evaluation should not be shown as failed.
  if (attempt.status !== "EVALUATED") return "pending";

  const passingThreshold = getPassingThreshold(test);

  // Fallback classification for evaluated attempts when resultStatus is missing:
  // Prefer unrounded percentage computed directly from raw totalScore and maxScore if available.
  if (
    typeof attempt.totalScore === "number" &&
    typeof attempt.maxScore === "number" &&
    attempt.maxScore > 0
  ) {
    const rawPercentage = (attempt.totalScore / attempt.maxScore) * 100;
    return rawPercentage >= passingThreshold ? "pass" : "fail";
  }

  // If raw score is unavailable, check supplied or stored percentage.
  const hasPercentage =
    (percentage !== null && percentage !== undefined && Number.isFinite(Number(percentage))) ||
    (attempt.percentage !== null && attempt.percentage !== undefined && Number.isFinite(Number(attempt.percentage)));

  if (!hasPercentage) {
    return "unknown";
  }

  const fallbackPercentage =
    typeof percentage === "number" && Number.isFinite(percentage)
      ? percentage
      : Number(attempt.percentage);

  return fallbackPercentage >= passingThreshold ? "pass" : "fail";
};

export const resolveSubjectName = (test) => {
  if (!test) return "General";

  // 1. Valid populated subjectIds subject name
  if (Array.isArray(test.subjectIds) && test.subjectIds.length > 0) {
    for (const sub of test.subjectIds) {
      if (sub && typeof sub.name === "string" && sub.name.trim()) {
        return sub.name.trim();
      }
    }
  }

  // 2. Valid populated subjectId name, only if supported by the actual schema
  if (test.subjectId && typeof test.subjectId.name === "string" && test.subjectId.name.trim()) {
    return test.subjectId.name.trim();
  }

  // 3. Valid nonempty test type, using the appropriate string value
  if (Array.isArray(test.type) && test.type.length > 0) {
    for (const t of test.type) {
      if (typeof t === "string" && t.trim()) {
        return t.trim();
      }
    }
  } else if (typeof test.type === "string" && test.type.trim()) {
    return test.type.trim();
  }

  // 4. Fallback to "General" when no valid subject is available
  return "General";
};

export const getStudentDashboardData = async (studentId) => {
  const _perfStartTime = performance.now();
  // `test.status` is only (re)computed at create/publish/update time (see
  // computeTestStatus) — nothing recomputes it as real time passes, so a
  // FIXED-schedule test whose window opened/closed since it was last saved
  // would sit with a stale UPCOMING/ACTIVE status forever, making this KPI
  // look frozen. Match the same live condition computeTestStatus would
  // derive right now instead of trusting the stored field.
  const now = new Date();
  // `req.user._id` comes straight from a decoded JWT, which is always a
  // plain string (JSON has no ObjectId type) — Mongoose's .find()/.findById
  // auto-cast that against a schema, but $match inside an aggregation
  // pipeline does NOT, so matching on the raw string here silently matched
  // zero documents for every student, every time, regardless of how many
  // assignments they actually had.
  const studentObjectId = new mongoose.Types.ObjectId(studentId);

  // 1. Independent query: Active assigned tests aggregation
  const activeAssignedTestsPromise = TestAssignment.aggregate([
    {
      $match: {
        studentId: studentObjectId,
        status: { $in: ["ACCEPTED", "STARTED"] },
      },
    },
    {
      $lookup: {
        from: "tests",
        localField: "testId",
        foreignField: "_id",
        as: "test",
      },
    },
    { $unwind: "$test" },
    {
      $match: {
        "test.isPublished": true,
        "test.isDeleted": { $ne: 1 },
        $or: [
          { "test.scheduleType": "IMMEDIATE" },
          {
            "test.scheduleType": "FIXED",
            "test.startTime": { $lte: now },
            "test.endTime": { $gte: now },
          },
        ],
      },
    },
    { $count: "count" },
  ]).catch((error) => {
    console.error("Failed to count active assigned tests:", error.message);
    return [];
  });

  // 2. Independent query: Pre-aggregated KPI summary
  const summaryPromise = isAnalyticsSummariesEnabled()
    ? StudentPerformanceSummary.findOne({ studentId })
        .lean()
        .catch((error) => {
          console.error(
            "Failed to load student performance summary:",
            error.message
          );
          return null;
        })
    : Promise.resolve(null);

  // 3. Independent query: Completed attempts history with field projection to avoid transmitting unused question texts and violation logs
  const attemptsQuery = TestAttempt.find({
    studentId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  })
    .select(
      "-questionSnapshots.questionText -questionSnapshots.options -questionSnapshots.correctAnswer -questionSnapshots.imageUrl -violations"
    )
    .sort({ submittedAt: 1 }); // Sort chronological to build timelines

  // If snapshot optimization is disabled, populate test metadata upfront
  if (!isAnalyticsSnapshotsEnabled()) {
    attemptsQuery.populate({
      path: "testId",
      select: "title visibility type duration topicIds subjectIds subjectId difficulty passingPercentage",
      populate: [
        { path: "topicIds", select: "name" },
        { path: "subjectIds", select: "name" },
        { path: "subjectId", select: "name" },
      ],
    });
  }

  // Execute all independent database operations concurrently
  const [activeAssignedTestsResult, summary, attempts] = await Promise.all([
    activeAssignedTestsPromise,
    summaryPromise,
    attemptsQuery.lean(),
  ]);

  const activeAssignedTests = activeAssignedTestsResult[0]?.count || 0;

  if (!attempts || attempts.length === 0) {
    recordDashboardRequest(performance.now() - _perfStartTime);
    return {
      totalTestsAttempted: 0,
      percentageAchieved: 0,
      accuracy: 0,
      subjectWiseTests: [],
      percentageOverTime: [],
      performanceOverTime: { weekly: [], monthly: [] },
      tests: [],
      allTests: [],
      activeAssignedTestsCount: activeAssignedTests,
    };
  }

  // Verify whether all attempts have a complete, valid analytics snapshot
  const allSnapshotsValid =
    isAnalyticsSnapshotsEnabled() &&
    attempts.every((a) => isValidSnapshot(a.analyticsSnapshot));

  let questionDifficultyMap = null;

  // Fallback path: If any attempt lacks a valid snapshot, populate test & fetch question difficulties
  if (!allSnapshotsValid) {
    if (isAnalyticsSnapshotsEnabled()) {
      let missingCount = 0;
      let malformedCount = 0;
      attempts.forEach((a) => {
        if (!a.analyticsSnapshot) missingCount++;
        else if (!isValidSnapshot(a.analyticsSnapshot)) malformedCount++;
      });
      recordSnapshotFallback({
        studentId,
        missingCount,
        malformedCount,
        totalAttempts: attempts.length,
        reason:
          missingCount > 0 && malformedCount > 0
            ? "MISSING_AND_MALFORMED"
            : missingCount > 0
            ? "MISSING_SNAPSHOTS"
            : "MALFORMED_SNAPSHOTS",
      });
    }
    const needsTestPopulate = attempts.some(
      (a) => !a.testId || typeof a.testId !== "object" || !a.testId.title
    );
    if (needsTestPopulate) {
      await TestAttempt.populate(attempts, {
        path: "testId",
        select: "title visibility type duration topicIds subjectIds subjectId difficulty passingPercentage",
        populate: [
          { path: "topicIds", select: "name" },
          { path: "subjectIds", select: "name" },
          { path: "subjectId", select: "name" },
        ],
      });
    }

    const allQuestionIds = new Set();
    attempts.forEach((attempt) => {
      (attempt.answers || []).forEach((a) => {
        if (a.questionId) allQuestionIds.add(String(a.questionId));
      });
    });

    const questions = await Question.find({ _id: { $in: Array.from(allQuestionIds) } })
      .select("difficulty")
      .lean();
    questionDifficultyMap = new Map(
      questions.map((q) => [String(q._id), toDifficultyLabel(q.difficulty)])
    );
  }

  let totalQuestionsAttempted = 0;
  let totalCorrectAnswers = 0;
  let rawScoredPercentageSum = 0;
  let rawScoredAttemptCount = 0;

  const subjectCountMap = {};
  const percentageOverTime = [];
  const weeklyBuckets = new Map();
  const monthlyBuckets = new Map();
  const recentTests = [];
  const allTests = [];

  attempts.forEach((attempt) => {
    const hasSnapshot = allSnapshotsValid && isValidSnapshot(attempt.analyticsSnapshot);
    const snapshot = hasSnapshot ? attempt.analyticsSnapshot : null;

    const testName = snapshot
      ? snapshot.testName || "Untitled Test"
      : attempt.testId?.title || "Untitled Test";
    const isEvaluated =
      attempt.status === "EVALUATED" ||
      attempt.resultStatus === "PASS" ||
      attempt.resultStatus === "FAIL";
    const hasValidScore =
      isEvaluated &&
      attempt.percentage !== null &&
      attempt.percentage !== undefined &&
      Number.isFinite(Number(attempt.percentage));
    const percentage = hasValidScore ? Number(attempt.percentage) : null;
    const submittedAt = attempt.submittedAt || new Date();

    if (hasValidScore) {
      rawScoredPercentageSum += percentage;
      rawScoredAttemptCount += 1;
    }

    const answers = attempt.answers || [];
    const totalQ = attempt.questionSnapshots?.length || answers.length || 0;

    const responseCount = answers.filter(answerHasValue).length;

    const correctQ = answers.filter(
      (answer) => answerHasValue(answer) && answer.isCorrect === true
    ).length;

    const wrongQ = answers.filter(
      (answer) => answerHasValue(answer) && answer.isCorrect === false
    ).length;

    // Pending subjective responses are not classified as skipped.
    const skippedQ = Math.max(0, totalQ - responseCount);

    const attemptedQ = correctQ + wrongQ;

    totalQuestionsAttempted += attemptedQ;
    totalCorrectAnswers += correctQ;

    // Subject-wise test counts must use subjects, not topics.
    const topics = new Set();

    if (snapshot && Array.isArray(snapshot.topics)) {
      snapshot.topics.forEach((topic) => {
        if (typeof topic === "string" && topic.trim()) {
          topics.add(topic.trim());
        }
      });
    } else if (snapshot?.topic) {
      topics.add(snapshot.topic);
    } else if (Array.isArray(attempt.testId?.topicIds)) {
      attempt.testId.topicIds.forEach((topic) => {
        if (topic?.name?.trim()) {
          topics.add(topic.name.trim());
        }
      });
    }

    if (topics.size === 0) {
      topics.add("General");
    }

    // Keep topic information separate for the allTests.topic field.
    const subjectNames = new Set();

    if (snapshot?.subject?.trim()) {
      subjectNames.add(snapshot.subject.trim());
    } else if (Array.isArray(attempt.testId?.subjectIds)) {
      attempt.testId.subjectIds.forEach((subject) => {
        if (subject?.name?.trim()) {
          subjectNames.add(subject.name.trim());
        }
      });

      // Legacy/single-subject schema fallback.
      if (subjectNames.size === 0) {
        const subjectName = resolveSubjectName(attempt.testId);
        if (subjectName) subjectNames.add(subjectName);
      }
    } else {
      subjectNames.add(resolveSubjectName(attempt.testId));
    }

    if (subjectNames.size === 0) {
      subjectNames.add("General");
    }

    subjectNames.forEach((subject) => {
      subjectCountMap[subject] = (subjectCountMap[subject] || 0) + 1;
    });

    // Percentage Over Time (only valid scores)
    if (hasValidScore) {
      percentageOverTime.push({
        testName,
        percentage,
      });
    }

    // Performance Over Time (Weekly / Monthly)
    const date = new Date(submittedAt);
    const { weekKey, weekNum, label: weekLabel } = getIsoWeekDetails(date);
    const monthNum = String(date.getMonth() + 1).padStart(2, "0");
    const monthKey = `${date.getFullYear()}-${monthNum}`;
    const monthLabel = date.toLocaleString("en-US", { month: "short", year: "numeric" });

    const weekEntry = weeklyBuckets.get(weekKey);
    if (weekEntry) {
      weekEntry.count += 1;
    } else {
      weeklyBuckets.set(weekKey, {
        key: weekKey,
        label: weekLabel,
        count: 1,
      });
    }

    const monthEntry = monthlyBuckets.get(monthKey);
    if (monthEntry) {
      monthEntry.count += 1;
    } else {
      monthlyBuckets.set(monthKey, {
        key: monthKey,
        label: monthLabel,
        count: 1,
      });
    }

    // Recent Tests format (Dashboard small table)
    const testCategory = snapshot
      ? snapshot.category || "Standard"
      : attempt.testId?.type || "Standard";

    recentTests.push({
      id: attempt.testId?._id || attempt.testId,
      resultId: attempt._id,
      name: testName,
      category: testCategory,
      difficulty: toDifficultyLabel(
        snapshot?.difficulty || attempt.testId?.difficulty
      ),
      attemptedAt: submittedAt,
      totalQuestions: totalQ,
      correctQuestions: correctQ,
      incorrectQuestions: wrongQ,
      percentage: percentage,
      timeTaken: formatDuration(getActualTimeTakenSeconds(attempt)),
      status: getAttemptResultStatus(attempt, percentage, attempt.testId),
    });

    // Detailed allTests array for advanced frontend filtering
    const primaryTopic = snapshot?.topic || (topics.size > 0 ? Array.from(topics)[0] : "General");
    const subject = snapshot?.subject || resolveSubjectName(attempt.testId);

    let difficultyBreakdown;
    if (snapshot && snapshot.difficultyBreakdown) {
      difficultyBreakdown = snapshot.difficultyBreakdown;
    } else {
      difficultyBreakdown = emptyDifficultyBreakdown();
      answers.forEach((a) => {
        const label = (questionDifficultyMap && questionDifficultyMap.get(String(a.questionId))) || "Medium";
        const bucket = difficultyBreakdown[label] || difficultyBreakdown.Medium;
        if (!answerHasValue(a)) {
          bucket.skipped += 1;
        } else if (a.isCorrect === true) {
          bucket.correct += 1;
        } else if (a.isCorrect === false) {
          bucket.wrong += 1;
        }
        // An answered question awaiting evaluation is neither wrong nor skipped.
      });
    }

    allTests.push({
      id: attempt.testId?._id || attempt.testId,
      resultId: attempt._id,
      name: testName,
      category: testCategory,
      difficulty: toDifficultyLabel(
        snapshot?.difficulty || attempt.testId?.difficulty
      ),
      subject: subject,
      topic: primaryTopic,
      difficultyBreakdown,
      totalQuestions: totalQ,
      correct: correctQ,
      correctQuestions: correctQ,
      wrong: wrongQ,
      incorrectQuestions: wrongQ,
      skipped: skippedQ,
      score: attempt.totalScore || 0,
      maxScore: attempt.maxScore || 0,
      percentage,
      accuracy:
        attemptedQ > 0
          ? Math.round((correctQ / attemptedQ) * 100)
          : 0,
      timeTaken: getActualTimeTakenSeconds(attempt),
      status: getAttemptResultStatus(attempt, percentage, attempt.testId),
      attemptedAt: submittedAt,
      date: submittedAt,
    });
  });

  // Calculate Aggregates
  const totalTestsAttempted = summary?.totalTestsAttempted ?? attempts.length;

  if (summary && summary.totalTestsAttempted > 0 && Math.abs(summary.totalTestsAttempted - attempts.length) > 0) {
    recordAnalyticsDiscrepancy({
      studentId,
      metric: "totalTestsAttempted",
      summaryValue: summary.totalTestsAttempted,
      computedValue: attempts.length,
    });
  }

  let percentageAchieved = null;
  if (summary && summary.totalTestsAttempted > 0 && summary.scoredAttemptCount > 0) {
    percentageAchieved = Math.round(summary.totalPercentageSum / summary.scoredAttemptCount);
  } else if (rawScoredAttemptCount > 0) {
    percentageAchieved = Math.round(rawScoredPercentageSum / rawScoredAttemptCount);
  } else {
    percentageAchieved = null;
  }

  // Keep the existing raw calculation for now.
  // The summary denominator must be aligned and backfilled first.
  const accuracy =
    totalQuestionsAttempted > 0
      ? Math.round((totalCorrectAnswers / totalQuestionsAttempted) * 100)
      : 0;

  // Format arrays
  const subjectWiseTests = Object.entries(subjectCountMap).map(([subject, count]) => ({
    subject,
    count,
  })).sort((a, b) => b.count - a.count); // Top subjects first

  const weekly = Array.from(weeklyBuckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => ({ key: entry.key, label: entry.label, count: entry.count }));

  const monthly = Array.from(monthlyBuckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => ({ key: entry.key, label: entry.label, count: entry.count }));

  // Return tests sorted newest first
  recentTests.sort((a, b) => new Date(b.attemptedAt) - new Date(a.attemptedAt));

  recordDashboardRequest(performance.now() - _perfStartTime);

  return {
    totalTestsAttempted,
    percentageAchieved,
    accuracy,
    subjectWiseTests,
    percentageOverTime,
    performanceOverTime: {
      weekly,
      monthly,
    },
    // Recent tests table capped at 10 items (E2.9.2-D: full depth preserved in allTests)
    tests: recentTests.slice(0, 10),
    allTests, // Contains ALL raw attempts for complex frontend filtering
    activeAssignedTestsCount: activeAssignedTests,
  };
};

const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const getDisplayName = (user) => {
  if (!user) return "Unknown Student";
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown Student";
};

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) =>
  new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
);

const getTrendBucketKey = (date, period) => {
  if (period === "today") {
    const hour = date.getHours();
    return { key: String(hour).padStart(2, "0"), label: HOUR_LABELS[hour] };
  }
  if (period === "weekly") {
    const { weekKey, label } = getIsoWeekDetails(date);
    return { key: weekKey, label };
  }
  if (period === "monthly") {
    const monthNum = String(date.getMonth() + 1).padStart(2, "0");
    return {
      key: `${date.getFullYear()}-${monthNum}`,
      label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
    };
  }
  // yearly
  return { key: String(date.getFullYear()), label: String(date.getFullYear()) };
};

// How many trailing buckets each granularity keeps — "today" is a single
// day's worth of hours (never more than 24 anyway); the others cap the chart
// to a readable trailing window rather than every bucket since the platform
// launched.
const TREND_BUCKET_CAPS = { today: 24, weekly: 12, monthly: 12, yearly: 6 };

// events: [{ studentId, date, category }]. Buckets at all four granularities
// in one pass and counts DISTINCT students per category per bucket (this
// feeds a "how many students engaged" trend, not "how many attempts
// happened") — the frontend just switches which array it renders, same
// convention as performanceOverTime/averageScoreOverTime above.
const buildEngagementTrend = (events, categories) => {
  const { start: todayStart, end: todayEnd } = getTodayRange();
  const result = {};

  Object.keys(TREND_BUCKET_CAPS).forEach((period) => {
    const relevant =
      period === "today" ? events.filter((e) => e.date >= todayStart && e.date < todayEnd) : events;

    const buckets = new Map();
    relevant.forEach(({ studentId, date, category }) => {
      if (!category || !studentId) return;
      const { key, label } = getTrendBucketKey(date, period);
      if (!buckets.has(key)) buckets.set(key, { label, sets: {} });
      const entry = buckets.get(key);
      if (!entry.sets[category]) entry.sets[category] = new Set();
      entry.sets[category].add(String(studentId));
    });

    const sortedKeys = Array.from(buckets.keys())
      .sort()
      .slice(-TREND_BUCKET_CAPS[period]);

    result[period] = sortedKeys.map((key) => {
      const { label, sets } = buckets.get(key);
      const row = { label };
      categories.forEach((cat) => {
        row[cat] = sets[cat] ? sets[cat].size : 0;
      });
      return row;
    });
  });

  return result;
};

const buildTrendFromDailyActivity = (activities, categories) => {
  const result = {};

  for (const period of ["weekly", "monthly", "yearly"]) {
    const buckets = new Map();

    for (const activity of activities) {
      if (!activity.studentId || !activity.sourceCategory) continue;

      const date = new Date(`${activity.dateKey}T00:00:00`);
      if (Number.isNaN(date.getTime())) continue;

      const { key, label } = getTrendBucketKey(date, period);

      if (!buckets.has(key)) {
        buckets.set(key, { label, sets: {} });
      }

      const bucket = buckets.get(key);

      if (!bucket.sets[activity.sourceCategory]) {
        bucket.sets[activity.sourceCategory] = new Set();
      }

      bucket.sets[activity.sourceCategory].add(String(activity.studentId));
    }

    result[period] = Array.from(buckets.keys())
      .sort()
      .slice(-TREND_BUCKET_CAPS[period])
      .map((key) => {
        const { label, sets } = buckets.get(key);
        const row = { label };

        for (const category of categories) {
          row[category] = sets[category]?.size ?? 0;
        }

        return row;
      });
  }

  return result;
};

export const buildEngagementMetrics = (attempts, testSubjectMap = null) => {
  // Keyed by year-qualified sort key (not just "Week 32" / "Aug") — plain
  // week-number/month-name labels collide across years (Week 32 of 2025 and
  // Week 32 of 2026, or two different Augusts), which used to silently
  // merge unrelated periods' counts into one bucket. A Map also preserves
  // real chronological order once sorted, unlike Object.entries() on a
  // plain object, which followed whatever order attempts happened to be
  // iterated in (the caller fetches attempts newest-first) — so the trend
  // chart's x-axis was rendering time running backwards.
  const weeklyBuckets = new Map();
  const monthlyBuckets = new Map();
  const subjectCountMap = {};
  
  // Weekly and monthly subject breakdowns
  const weeklySubjectBuckets = new Map();
  const monthlySubjectBuckets = new Map();

  attempts.forEach((attempt) => {
    const submittedAt = attempt.submittedAt || attempt.updatedAt || attempt.createdAt || new Date();
    const date = new Date(submittedAt);

    const isEvaluated =
      attempt.status === "EVALUATED" ||
      attempt.resultStatus === "PASS" ||
      attempt.resultStatus === "FAIL";
    const hasValidScore =
      isEvaluated &&
      attempt.percentage !== null &&
      attempt.percentage !== undefined &&
      Number.isFinite(Number(attempt.percentage));
    const percentage = hasValidScore ? Number(attempt.percentage) : null;

    const { weekKey, weekNum, label: weekLabel } = getIsoWeekDetails(date);
    const weekEntry = weeklyBuckets.get(weekKey);
    if (weekEntry) {
      weekEntry.count += 1;
      if (percentage !== null) {
        weekEntry.scoreSum += percentage;
        weekEntry.scoredCount += 1;
      }
    } else {
      weeklyBuckets.set(weekKey, {
        key: weekKey,
        label: weekLabel,
        count: 1,
        scoreSum: percentage !== null ? percentage : 0,
        scoredCount: percentage !== null ? 1 : 0,
      });
    }

    const monthNum = String(date.getMonth() + 1).padStart(2, "0");
    const monthKey = `${date.getFullYear()}-${monthNum}`;
    const monthEntry = monthlyBuckets.get(monthKey);
    if (monthEntry) {
      monthEntry.count += 1;
      if (percentage !== null) {
        monthEntry.scoreSum += percentage;
        monthEntry.scoredCount += 1;
      }
    } else {
      monthlyBuckets.set(monthKey, {
        key: monthKey,
        label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
        count: 1,
        scoreSum: percentage !== null ? percentage : 0,
        scoredCount: percentage !== null ? 1 : 0,
      });
    }

    const subjects =
      (testSubjectMap ? testSubjectMap.get(String(attempt.testId?._id || attempt.testId)) : null) ||
      attempt.testId?.subjectIds ||
      [];
    if (Array.isArray(subjects) && subjects.length > 0) {
      subjects.forEach((subject) => {
        const name = subject?.name || "General";
        subjectCountMap[name] = (subjectCountMap[name] || 0) + 1;
        
        // Weekly subject breakdown
        const weekSubjectKey = `${weekKey}-${name}`;
        weeklySubjectBuckets.set(weekSubjectKey, (weeklySubjectBuckets.get(weekSubjectKey) || 0) + 1);
        
        // Monthly subject breakdown
        const monthSubjectKey = `${monthKey}-${name}`;
        monthlySubjectBuckets.set(monthSubjectKey, (monthlySubjectBuckets.get(monthSubjectKey) || 0) + 1);
      });
    } else {
      subjectCountMap.General = (subjectCountMap.General || 0) + 1;
      
      // Weekly General breakdown
      const weekSubjectKey = `${weekKey}-General`;
      weeklySubjectBuckets.set(weekSubjectKey, (weeklySubjectBuckets.get(weekSubjectKey) || 0) + 1);
      
      // Monthly General breakdown
      const monthSubjectKey = `${monthKey}-General`;
      monthlySubjectBuckets.set(monthSubjectKey, (monthlySubjectBuckets.get(monthSubjectKey) || 0) + 1);
    }
  });

  const sortedBucketValues = (buckets) =>
    Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, label: value.label, count: value.count }));

  // Helper to get current period key
  const getCurrentWeekKey = () => {
    return getIsoWeekDetails(new Date()).weekKey;
  };

  const getCurrentMonthKey = () => {
    const now = new Date();
    const monthNum = String(now.getMonth() + 1).padStart(2, "0");
    return `${now.getFullYear()}-${monthNum}`;
  };

  // Helper to aggregate subject data for a specific period
  const aggregateSubjectsForPeriod = (subjectBuckets, periodKey) => {
    const result = new Map();
    const prefix = periodKey + "-";

    subjectBuckets.forEach((count, key) => {
      if (key.startsWith(prefix)) {
        const subject = key.substring(prefix.length);
        if (!result.has(subject)) {
          result.set(subject, 0);
        }
        result.set(subject, result.get(subject) + count);
      }
    });

    return Array.from(result.entries())
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Same buckets as the activity chart above (so the two line up period for
  // period), but averaging each attempt's score instead of just counting
  // it — "how many tests happened" and "how well did they go" are two
  // different questions, and used to be conflated into one confusing
  // per-attempt scatter plot (every single attempt across every student and
  // test on the platform, plotted as one dot each with no shared axis to
  // make sense of — not an actual trend a person could read). Supersedes
  // the old percentageOverTime field, which plotted exactly that scatter.
  const sortedScoreBucketValues = (buckets) =>
    Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({
        key,
        label: value.label,
        avgScore: value.scoredCount > 0 ? Math.round(value.scoreSum / value.scoredCount) : null,
      }));

  return {
    performanceOverTime: {
      weekly: sortedBucketValues(weeklyBuckets),
      monthly: sortedBucketValues(monthlyBuckets),
    },
    averageScoreOverTime: {
      weekly: sortedScoreBucketValues(weeklyBuckets),
      monthly: sortedScoreBucketValues(monthlyBuckets),
    },
    subjectWiseTests: {
      overall: Object.entries(subjectCountMap)
        .map(([subject, count]) => ({ subject, count }))
        .sort((a, b) => b.count - a.count),
      weekly: aggregateSubjectsForPeriod(weeklySubjectBuckets, getCurrentWeekKey()),
      monthly: aggregateSubjectsForPeriod(monthlySubjectBuckets, getCurrentMonthKey()),
    },
  };
};

const buildAdminOrgDashboardData = async ({ orgId = null, adminUserId = null, isAdmin = false } = {}) => {
  const _adminStartTime = performance.now();
  const { start, end } = getTodayRange();
  const studentFilter = {
    role: "STUDENT",
    isDeleted: { $ne: true },
    ...(orgId ? { organizationId: orgId } : {}),
  };

  const supportFilter = orgId ? { organizationId: orgId } : {};
  const testFilter = isAdmin
    ? { isDeleted: { $ne: 1 } }
    : {
      isDeleted: { $ne: 1 },
      $or: [
        ...(adminUserId ? [{ "createdBy.userId": adminUserId }] : []),
        ...(orgId ? [{ allowedOrganizations: orgId }] : []),
      ],
    };
  const withTestFilter = (extraFilter) => (
    isAdmin ? { ...testFilter, ...extraFilter } : { $and: [testFilter, extraFilter] }
  );
  const seriesFilter = {
    $or: [
      ...(adminUserId ? [{ "createdBy.userId": adminUserId }] : []),
      ...(orgId ? [{ allowedOrganizations: orgId }] : []),
    ],
  };

  // `status` is only (re)computed at create/publish/update time (see
  // computeTestStatus) — nothing recomputes it as real time passes, so a
  // FIXED-schedule test whose window ended can sit with a stale
  // ACTIVE/UPCOMING status forever. "Completed"/"Scheduled" below are
  // time-aware (not just a stored-status lookup) so a test's schedule
  // window ending actually moves it between these buckets immediately,
  // rather than only when something happens to re-save it.
  const now = new Date();
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
  const liveActiveCondition = {
    isPublished: true,
    $or: [
      { scheduleType: "IMMEDIATE" },
      { scheduleType: "FIXED", startTime: { $lte: now }, endTime: { $gte: now } },
    ],
  };
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // E2.9.2-C: Concurrently launch scoping promise without blocking independent Stream 1 & Stream 5
  const scopingPromise = isAdmin
    ? Promise.resolve({ testIds: [], studentIds: [], ownOrgTestIds: [] })
    : (async () => {
        const [scopedTests, scopedStudents] = await Promise.all([
          Test.find(testFilter).select("_id createdBy.userId createdBy.role").lean(),
          User.find(studentFilter).select("_id createdAt").lean(),
        ]);
        const testIds = scopedTests.map((test) => test._id);
        const studentIds = scopedStudents.map((student) => student._id);
        // E2.9.2-C: Reuse scopedTests for organization created tests instead of re-querying in Stream 6
        const ownOrgTestIds = adminUserId
          ? scopedTests
              .filter(
                (t) =>
                  t.createdBy?.role === "ORGANIZATION" &&
                  String(t.createdBy?.userId) === String(adminUserId)
              )
              .map((t) => t._id)
          : [];
        return { testIds, studentIds, ownOrgTestIds };
      })();

  // Stream 1: Overview and KPI counts (launches immediately in parallel with scoping)
  const countsPromise = Promise.all([
    User.countDocuments(studentFilter),
    isAdmin ? Organization.countDocuments() : Promise.resolve(0),
    Test.countDocuments(withTestFilter(liveActiveCondition)),
    isAdmin ? Test.countDocuments({ ...testFilter, ...liveActiveCondition, "createdBy.role": "IQPATH_ADMIN" }) : Promise.resolve(0),
    isAdmin ? Test.countDocuments({ ...testFilter, ...liveActiveCondition, "createdBy.role": "ORGANIZATION" }) : Promise.resolve(0),
    // The real "how many tests exist" count — every status, not just active.
    Test.countDocuments(testFilter),
    Test.countDocuments(withTestFilter(liveCompletedCondition)),
    Test.countDocuments(withTestFilter({
      $or: [
        { startTime: { $gte: start, $lt: end } },
        { createdAt: { $gte: start, $lt: end } },
      ],
    })),
    Test.countDocuments(withTestFilter(liveScheduledCondition)),
    HelpSupport.countDocuments(supportFilter),
    HelpSupport.countDocuments({ ...supportFilter, status: "pending" }),
    HelpSupport.countDocuments({ ...supportFilter, status: "resolved" }),
    UserSubscription.aggregate([
      { $match: { status: "ACTIVE" } },
      {
        $lookup: {
          from: "plans",
          localField: "planId",
          foreignField: "_id",
          as: "plan"
        }
      },
      { $unwind: "$plan" },
      {
        $lookup: {
          from: "roles",
          localField: "plan.roleId",
          foreignField: "_id",
          as: "role"
        }
      },
      { $unwind: "$role" },
      {
        $group: {
          _id: { roleName: "$role.name", planName: "$plan.name", planId: "$plan._id", price: "$plan.price" },
          count: { $sum: 1 }
        }
      }
    ]),
    Test.countDocuments({ ...testFilter, isPublished: false }),
    Test.countDocuments({ ...testFilter, isPublished: true }),
    TestSeries.countDocuments(isAdmin ? {} : seriesFilter),
    User.countDocuments({ ...studentFilter, createdAt: { $gte: monthStart } }),
  ]);

  // Stream 2: Assignment counts
  const assignmentsPromise = (async () => {
    const { testIds, studentIds } = await scopingPromise;
    const assignmentFilter = isAdmin
      ? {}
      : { testId: { $in: testIds }, studentId: { $in: studentIds } };
    return Promise.all([
      TestAssignment.countDocuments({ ...assignmentFilter, status: "ACCEPTED" }),
      TestAssignment.countDocuments({ ...assignmentFilter, status: "DECLINED" }),
      TestAssignment.countDocuments({ ...assignmentFilter, status: "MISSED" }),
    ]);
  })();

  // Stream 3A: Recent 10 attempts for table display (index-supported sort, lightweight population)
  const recentAttemptsPromise = (async () => {
    const { testIds, studentIds } = await scopingPromise;
    const attemptFilter = {
      status: { $in: ["SUBMITTED", "EVALUATED"] },
      ...(isAdmin ? {} : { testId: { $in: testIds }, studentId: { $in: studentIds } }),
    };
    return TestAttempt.find(attemptFilter)
      .select("status resultStatus percentage submittedAt updatedAt createdAt testId studentId")
      .populate("studentId", "firstName lastName email")
      .populate({
        path: "testId",
        select: "title",
      })
      .sort({ submittedAt: -1 })
      .limit(10)
      .lean();
  })();

  // E2.9.2-A: Historical attempts AND subject resolution chained concurrently in parallel
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const historicalAnalyticsPromise = (async () => {
    const { testIds, studentIds } = await scopingPromise;
    const attemptFilter = {
      status: { $in: ["SUBMITTED", "EVALUATED"] },
      ...(isAdmin ? {} : { testId: { $in: testIds }, studentId: { $in: studentIds } }),
      submittedAt: { $gte: oneYearAgo },
    };
    const attempts = await TestAttempt.find(attemptFilter)
      .select("status resultStatus percentage submittedAt updatedAt createdAt testId")
      .sort({ submittedAt: -1 })
      .lean();

    const distinctTestIds = [
      ...new Set(attempts.map((a) => String(a.testId)).filter(Boolean)),
    ];

    const historicalTests = distinctTestIds.length > 0
      ? await Test.find({ _id: { $in: distinctTestIds } })
          .select("subjectIds")
          .populate({ path: "subjectIds", select: "name" })
          .lean()
      : [];

    const testSubjectMap = new Map(
      historicalTests.map((t) => [String(t._id), t.subjectIds || []])
    );

    return { attempts, testSubjectMap };
  })();

  // Stream 4: Today attempts count
  const todayAttemptsPromise = (async () => {
    const { testIds, studentIds } = await scopingPromise;
    const attemptFilter = {
      status: { $in: ["SUBMITTED", "EVALUATED"] },
      ...(isAdmin ? {} : { testId: { $in: testIds }, studentId: { $in: studentIds } }),
      submittedAt: { $gte: start, $lt: end },
    };
    return TestAttempt.countDocuments(attemptFilter);
  })();

  // Stream 5: Series overview data (launches immediately)
  const seriesPromise = (async () => {
    const series = await TestSeries.find(isAdmin ? {} : seriesFilter)
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
  })();

  // Stream 6: Student Engagement Trend
  const engagementTrendPromise = (async () => {
    if (isAdmin) {
      const adminCategories = ["selfCreated", "organization", "admin", "iqRoom"];
      const adminSeries = [
        { key: "selfCreated", label: "Self-Created Tests" },
        { key: "organization", label: "Organization Tests" },
        { key: "admin", label: "Admin Tests" },
        { key: "iqRoom", label: "IQ Room Tests" },
      ];

      if (isSummaryEngagementTrendEnabled()) {
        try {
          const minDate = new Date();
          minDate.setFullYear(minDate.getFullYear() - 6);
          const minimumDateKey = minDate.toISOString().slice(0, 10);

          // Bounded queries: only today's attempts for hourly trend, and daily activities for longer buckets
          const [todayAttempts, activities] = await Promise.all([
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
          ]);

          const categoryForAttempt = (attempt) => {
            if (attempt.testId?.isIQRoomTest) return "iqRoom";
            const role = attempt.testId?.createdBy?.role;
            if (role === "STUDENT") return "selfCreated";
            if (role === "ORGANIZATION") return "organization";
            if (role === "IQPATH_ADMIN") return "admin";
            return null;
          };

          const todayEvents = todayAttempts.map((attempt) => ({
            studentId: attempt.studentId,
            date: new Date(attempt.submittedAt || attempt.updatedAt || attempt.createdAt),
            category: categoryForAttempt(attempt),
          }));
          const todayTrend = buildEngagementTrend(todayEvents, adminCategories);
          const longRangeTrends = buildTrendFromDailyActivity(activities, adminCategories);

          return {
            series: adminSeries,
            today: todayTrend.today,
            weekly: longRangeTrends.weekly,
            monthly: longRangeTrends.monthly,
            yearly: longRangeTrends.yearly,
          };
        } catch (summaryErr) {
          console.error(
            "Failed to build admin trend from summaries, falling back to raw:",
            summaryErr.message
          );
        }
      }

      // Raw Fallback for Admin Trend
      const allAttempts = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
        .select("studentId submittedAt updatedAt createdAt testId")
        .populate({ path: "testId", select: "createdBy isIQRoomTest" })
        .lean();

      const categoryForAttempt = (attempt) => {
        if (attempt.testId?.isIQRoomTest) return "iqRoom";
        const role = attempt.testId?.createdBy?.role;
        if (role === "STUDENT") return "selfCreated";
        if (role === "ORGANIZATION") return "organization";
        if (role === "IQPATH_ADMIN") return "admin";
        return null;
      };

      const engagementEvents = allAttempts.map((attempt) => ({
        studentId: attempt.studentId,
        date: new Date(attempt.submittedAt || attempt.updatedAt || attempt.createdAt),
        category: categoryForAttempt(attempt),
      }));

      return {
        series: adminSeries,
        ...buildEngagementTrend(engagementEvents, adminCategories),
      };
    } else {
      // Organization Trend with Reused Scoped Tests (E2.9.2-C)
      const { studentIds, ownOrgTestIds } = await scopingPromise;
      const selfCreatedTests = await Test.find({
        "createdBy.role": "STUDENT",
        "createdBy.userId": { $in: studentIds },
        isDeleted: { $ne: 1 },
      })
        .select("createdBy.userId createdAt")
        .lean();

      const orgAttempts = ownOrgTestIds.length
        ? await TestAttempt.find({
            testId: { $in: ownOrgTestIds },
            studentId: { $in: studentIds },
            status: { $in: ["SUBMITTED", "EVALUATED"] },
          })
            .select("studentId submittedAt updatedAt createdAt")
            .lean()
        : [];

      const engagementEvents = [
        ...selfCreatedTests.map((test) => ({
          studentId: test.createdBy?.userId,
          date: new Date(test.createdAt),
          category: "selfCreated",
        })),
        ...orgAttempts.map((attempt) => ({
          studentId: attempt.studentId,
          date: new Date(attempt.submittedAt || attempt.updatedAt || attempt.createdAt),
          category: "organization",
        })),
      ];

      return {
        series: [
          { key: "selfCreated", label: "Self-Created Tests" },
          { key: "organization", label: "Organization Tests Taken" },
        ],
        ...buildEngagementTrend(engagementEvents, ["selfCreated", "organization"]),
      };
    }
  })();

  // Execute all independent database streams concurrently
  const [
    scopingResult,
    [
      totalStudents,
      totalOrganizations,
      activeTests,
      activeAdminTests,
      activeOrgTests,
      totalTestsCount,
      completedTests,
      todayTests,
      scheduledTests,
      supportTotal,
      supportPending,
      supportCompleted,
      planDistributionRaw,
      draftTestsCount,
      publishedTestsCount,
      totalTestSeries,
      newStudentsThisMonth,
    ],
    [acceptedAssignments, declinedAssignments, missedAssignments],
    recentAttempts,
    { attempts: historicalAttempts, testSubjectMap },
    todayAttempts,
    { series, seriesAssignments },
    studentEngagementTrend,
  ] = await Promise.all([
    scopingPromise,
    countsPromise,
    assignmentsPromise,
    recentAttemptsPromise,
    historicalAnalyticsPromise,
    todayAttemptsPromise,
    seriesPromise,
    engagementTrendPromise,
  ]);

  // E2.9.2-B: Eliminate redundant collection-wide distinct scan.
  // Derive completed test IDs from historicalAttempts (covering the past 1 year).
  // For any series test outside the 1-year window, query only that specific subset.
  const completedInWindow = new Set(
    historicalAttempts.map((a) => String(a.testId)).filter(Boolean)
  );
  const seriesTestIds = series.flatMap((item) => (item.tests || []).map(String));
  const uncachedSeriesTestIds = [...new Set(seriesTestIds)].filter(
    (id) => !completedInWindow.has(id)
  );

  let completedTestIds = completedInWindow;
  if (uncachedSeriesTestIds.length > 0) {
    const extraAttemptFilter = {
      status: { $in: ["SUBMITTED", "EVALUATED"] },
      ...(isAdmin
        ? {}
        : {
            testId: { $in: scopingResult.testIds },
            studentId: { $in: scopingResult.studentIds },
          }),
      testId: { $in: uncachedSeriesTestIds },
    };
    const extraCompleted = await TestAttempt.distinct("testId", extraAttemptFilter);
    completedTestIds = new Set([...completedInWindow, ...extraCompleted.map(String)]);
  }

  const { performanceOverTime, subjectWiseTests, averageScoreOverTime } = buildEngagementMetrics(
    historicalAttempts,
    testSubjectMap,
  );

  const recentTests = recentAttempts.map((attempt) => {
    const hasScore =
      attempt.percentage !== null &&
      attempt.percentage !== undefined &&
      Number.isFinite(Number(attempt.percentage));
    const scoreVal = hasScore ? Math.round(Number(attempt.percentage)) : null;

    return {
      id: attempt._id,
      testId: attempt.testId?._id || attempt.testId,
      studentName: getDisplayName(attempt.studentId),
      testName: attempt.testId?.title || "Untitled Test",
      score: scoreVal,
      status: getAttemptResultStatus(attempt, attempt.percentage, attempt.testId),
      resultStatus: attempt.resultStatus || null,
      date: attempt.submittedAt || attempt.updatedAt || attempt.createdAt,
    };
  });

  const assignmentCountBySeries = new Map(
    seriesAssignments.map((item) => [String(item._id), item.students]),
  );
  const seriesColors = ["#3F5BF6", "#16A34A", "#F59E0B", "#A855F7", "#0891B2"];
  const testSeriesOverview = series.map((item, index) => {
    const scopedTests = isAdmin
      ? item.tests || []
      : (item.tests || []).filter((testId) =>
        scopingResult.testIds.some((scopedId) => String(scopedId) === String(testId)),
      );
    const completedTestsInSeries = scopedTests.filter((testId) =>
      completedTestIds.has(String(testId)),
    ).length;

    return {
      id: item._id,
      name: item.title,
      tests: scopedTests.length,
      students: assignmentCountBySeries.get(String(item._id)) || 0,
      progress: scopedTests.length
        ? Math.round((completedTestsInSeries / scopedTests.length) * 100)
        : 0,
      color: seriesColors[index % seriesColors.length],
    };
  });

  const planDistribution = {
    students: [],
    organizations: []
  };

  planDistributionRaw.forEach((stat) => {
    const { roleName, planName, planId, price } = stat._id;
    const planInfo = { planName, planId, count: stat.count, price };
    
    // We only have orgs and students right now
    if (roleName === "STUDENT") {
      planDistribution.students.push(planInfo);
    } else if (roleName === "ORGANIZATION") {
      planDistribution.organizations.push(planInfo);
    }
  });

  recordDashboardRequest(performance.now() - _adminStartTime, isAdmin ? "ADMIN" : "ORGANIZATION");

  return {
    students: {
      total: totalStudents,
      newThisMonth: newStudentsThisMonth,
      plans: planDistribution.students,
    },
    organizations: {
      total: totalOrganizations,
      plans: planDistribution.organizations,
    },
    tests: {
      total: totalTestsCount,
      totalActive: activeTests,
      activeAdmin: activeAdminTests,
      activeOrg: activeOrgTests,
      completed: completedTests,
      today: todayTests,
      scheduled: scheduledTests,
      drafts: draftTestsCount,
      published: publishedTestsCount,
    },
    assignments: {
      accepted: acceptedAssignments,
      declined: declinedAssignments,
      missed: missedAssignments,
    },
    supportQueries: {
      total: supportTotal,
      pending: supportPending,
      completed: supportCompleted,
    },
    testSeries: {
      total: totalTestSeries,
    },
    todayAttempts,
    testSeriesOverview,
    performanceOverTime,
    averageScoreOverTime,
    recentTests,
    subjectWiseTests,
    studentEngagementTrend,
  };
};

export const getAdminDashboardData = async () => {
  return buildAdminOrgDashboardData({ isAdmin: true });
};

export const getOrganizationDashboardData = async (orgId, adminUserId) => {
  return buildAdminOrgDashboardData({ orgId, adminUserId, isAdmin: false });
};
