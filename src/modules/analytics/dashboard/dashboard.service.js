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

export const getStudentDashboardData = async (studentId) => {
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
  const activeAssignedTestsCount = await TestAssignment.aggregate([
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
  ]);

  const activeAssignedTests = activeAssignedTestsCount[0]?.count || 0;

  // Fetch all completed/submitted attempts for the student
  const attempts = await TestAttempt.find({
    studentId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  })
    .populate({
      path: "testId",
      select: "title visibility type duration topicIds subjectIds difficulty",
      populate: [
        { path: "topicIds", select: "name" },
        { path: "subjectIds", select: "name" }
      ]
    })
    .sort({ submittedAt: 1 }) // Sort chronological to build timelines
    .lean();

  if (!attempts || attempts.length === 0) {
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

  // "Difficulty Analysis" used to read Test.difficulty — an optional
  // whole-test tag that's almost never set by test creators, so it silently
  // defaulted every test to "Medium" and made the chart meaningless (every
  // student's questions appeared to be Medium regardless of reality). Real
  // difficulty lives per-QUESTION on the Question doc, so batch-fetch it
  // once here and look it up per answer below instead.
  const allQuestionIds = new Set();
  attempts.forEach((attempt) => {
    (attempt.answers || []).forEach((a) => {
      if (a.questionId) allQuestionIds.add(String(a.questionId));
    });
  });

  const questions = await Question.find({ _id: { $in: Array.from(allQuestionIds) } })
    .select("difficulty")
    .lean();
  const questionDifficultyMap = new Map(
    questions.map((q) => [String(q._id), toDifficultyLabel(q.difficulty)])
  );

  let totalQuestionsAttempted = 0;
  let totalCorrectAnswers = 0;
  let totalPercentageSum = 0;

  const subjectCountMap = {};
  const percentageOverTime = [];
  const weeklyMap = {};
  const monthlyMap = {};
  const recentTests = [];
  const allTests = [];

  // Month Names for formatting
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Helper to get week number
  const getWeekNumber = (d) => {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  attempts.forEach((attempt) => {
    const testName = attempt.testId?.title || "Untitled Test";
    const percentage = attempt.percentage || 0;
    const submittedAt = attempt.submittedAt || new Date();

    totalPercentageSum += percentage;

    // Accuracy = correct answers / attempted questions (correct + incorrect),
    // excluding unattempted/skipped questions from the denominator entirely —
    // not answers.length, which also counted skipped-but-recorded answers.
    const answers = attempt.answers || [];
    const correctQ = answers.filter((a) => a.isCorrect).length;
    const wrongQ = answers.filter((a) => !a.isCorrect && a.selectedOption).length;
    const skippedQ = answers.filter((a) => !a.isCorrect && !a.selectedOption).length;
    const attemptedQ = correctQ + wrongQ;

    totalQuestionsAttempted += attemptedQ;
    totalCorrectAnswers += correctQ;

    // Subject/Topic Wise tests count
    const topics = new Set();
    if (attempt.testId && Array.isArray(attempt.testId.topicIds)) {
      attempt.testId.topicIds.forEach((topic) => {
        if (topic && topic.name) topics.add(topic.name);
      });
    }

    // Default subject if no topics found
    if (topics.size === 0) topics.add("General");

    topics.forEach(topic => {
      subjectCountMap[topic] = (subjectCountMap[topic] || 0) + 1;
    });

    // Percentage Over Time
    percentageOverTime.push({
      testName,
      percentage,
    });

    // Performance Over Time (Weekly / Monthly)
    const date = new Date(submittedAt);
    const weekLabel = `Week ${getWeekNumber(date)}`;
    const monthLabel = monthNames[date.getMonth()];

    weeklyMap[weekLabel] = (weeklyMap[weekLabel] || 0) + 1;
    monthlyMap[monthLabel] = (monthlyMap[monthLabel] || 0) + 1;

    // Recent Tests format (Dashboard small table)
    const totalQ = attempt.questionSnapshots?.length || answers.length || 0;

    recentTests.push({
      id: attempt.testId?._id || attempt.testId,
      resultId: attempt._id,
      name: testName,
      category: attempt.testId?.type || "Standard",
      difficulty: "Medium", // Not always strictly defined
      attemptedAt: submittedAt,
      totalQuestions: totalQ,
      correctQuestions: correctQ,
      incorrectQuestions: wrongQ,
      percentage: percentage,
      timeTaken: `${attempt.duration || 0} minutes`,
      status: percentage >= 40 ? "pass" : "fail",
    });

    // Detailed allTests array for advanced frontend filtering
    const primaryTopic = topics.size > 0 ? Array.from(topics)[0] : "General";

    // We map test type to subject, or fallback to 'General'
    let subject = "General";
    if (attempt.testId && Array.isArray(attempt.testId.subjectIds) && attempt.testId.subjectIds.length > 0) {
      const firstSubject = attempt.testId.subjectIds[0];
      if (firstSubject && firstSubject.name) {
        subject = firstSubject.name;
      }
    } else if (attempt.testId?.type) {
      subject = attempt.testId.type;
    }

    // Real per-question difficulty breakdown for this attempt (Easy/Medium/
    // Hard), built from the actual Question docs rather than the test-level
    // tag above.
    const difficultyBreakdown = emptyDifficultyBreakdown();
    answers.forEach((a) => {
      const label = questionDifficultyMap.get(String(a.questionId)) || "Medium";
      const bucket = difficultyBreakdown[label];
      if (a.isCorrect) bucket.correct += 1;
      else if (a.selectedOption) bucket.wrong += 1;
      else bucket.skipped += 1;
    });

    allTests.push({
      id: attempt.testId?._id || attempt.testId,
      resultId: attempt._id,
      name: testName,
      subject: subject,
      topic: primaryTopic,
      difficultyBreakdown,
      totalQuestions: totalQ,
      correct: correctQ,
      wrong: wrongQ,
      skipped: skippedQ,
      score: attempt.totalScore || 0,
      maxScore: attempt.maxScore || 0,
      // Score as a percentage of that test's max — what "Average Score" on
      // the dashboard actually needs; averaging raw `score` across tests
      // with different max scores produces a meaningless number.
      percentage,
      accuracy: attemptedQ > 0 ? Math.round((correctQ / attemptedQ) * 100) : 0,
      timeTaken: attempt.duration || 0,
      date: submittedAt
    });
  });

  // Calculate Aggregates
  const totalTestsAttempted = attempts.length;
  const percentageAchieved = totalTestsAttempted > 0 ? Math.round(totalPercentageSum / totalTestsAttempted) : 0;
  const accuracy = totalQuestionsAttempted > 0 ? Math.round((totalCorrectAnswers / totalQuestionsAttempted) * 100) : 0;

  // Format arrays
  const subjectWiseTests = Object.entries(subjectCountMap).map(([subject, count]) => ({
    subject,
    count,
  })).sort((a, b) => b.count - a.count); // Top subjects first

  const weekly = Object.entries(weeklyMap).map(([label, count]) => ({ label, count }));
  const monthly = Object.entries(monthlyMap).map(([label, count]) => ({ label, count }));

  // Return tests sorted newest first
  recentTests.sort((a, b) => new Date(b.attemptedAt) - new Date(a.attemptedAt));

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
    // Full list, not capped — this feeds the "Test Wise Analysis" tab's
    // search/filter/date-range UI, which needs the student's complete test
    // history to filter over, not just the most recent few.
    tests: recentTests,
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

const buildEngagementMetrics = (attempts) => {
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

  const getWeekNumber = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  attempts.forEach((attempt) => {
    const submittedAt = attempt.submittedAt || attempt.updatedAt || attempt.createdAt || new Date();
    const date = new Date(submittedAt);

    const weekNum = getWeekNumber(date);
    const weekKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    const weekEntry = weeklyBuckets.get(weekKey);
    if (weekEntry) weekEntry.count += 1;
    else weeklyBuckets.set(weekKey, { label: `Week ${weekNum}`, count: 1 });

    const monthKey = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`;
    const monthEntry = monthlyBuckets.get(monthKey);
    if (monthEntry) monthEntry.count += 1;
    else monthlyBuckets.set(monthKey, {
      label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
      count: 1,
    });

    const subjects = attempt.testId?.subjectIds || [];
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
      .map(([, value]) => value);

  // Helper to get current period key
  const getCurrentWeekKey = () => {
    const now = new Date();
    const weekNum = getWeekNumber(now);
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  };
  
  const getCurrentMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;
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

  // Percentage Over Time (chronological, oldest first) — `attempts` arrives
  // sorted newest-first for the recent-tests table, so sort a copy here
  // rather than relying on caller order.
  const percentageOverTime = [...attempts]
    .sort((a, b) => {
      const dateA = new Date(a.submittedAt || a.updatedAt || a.createdAt || 0);
      const dateB = new Date(b.submittedAt || b.updatedAt || b.createdAt || 0);
      return dateA - dateB;
    })
    .map((attempt) => ({
      testName: attempt.testId?.title || "Untitled Test",
      percentage: Math.round(attempt.percentage || 0),
    }));

  return {
    performanceOverTime: {
      weekly: sortedBucketValues(weeklyBuckets),
      monthly: sortedBucketValues(monthlyBuckets),
    },
    subjectWiseTests: {
      overall: Object.entries(subjectCountMap)
        .map(([subject, count]) => ({ subject, count }))
        .sort((a, b) => b.count - a.count),
      weekly: aggregateSubjectsForPeriod(weeklySubjectBuckets, getCurrentWeekKey()),
      monthly: aggregateSubjectsForPeriod(monthlySubjectBuckets, getCurrentMonthKey()),
    },
    percentageOverTime,
  };
};

const buildAdminOrgDashboardData = async ({ orgId = null, adminUserId = null, isAdmin = false } = {}) => {
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

  const [
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
    scopedTests,
    scopedStudents,
    planDistributionRaw,
    draftTestsCount,
    publishedTestsCount,
    totalTestSeries,
  ] = await Promise.all([
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
    // Only the org branch actually uses these id lists (to scope
    // assignments/attempts to "this org's tests/students") — for the admin
    // branch they're discarded below, so skip fetching every test/student
    // id on the whole platform just to throw it away.
    isAdmin ? Promise.resolve([]) : Test.find(testFilter).select("_id").lean(),
    isAdmin ? Promise.resolve([]) : User.find(studentFilter).select("_id createdAt").lean(),
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
  ]);

  const testIds = scopedTests.map((test) => test._id);
  const studentIds = scopedStudents.map((student) => student._id);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newStudentsThisMonth = scopedStudents.filter(
    (student) => student.createdAt && new Date(student.createdAt) >= monthStart,
  ).length;

  const TestAssignment = (await import("../../../models/testAssignment.model.js")).default;
  const assignmentFilter = isAdmin
    ? {}
    : { testId: { $in: testIds }, studentId: { $in: studentIds } };

  const [
    acceptedAssignments,
    declinedAssignments,
    missedAssignments,
  ] = await Promise.all([
    TestAssignment.countDocuments({ ...assignmentFilter, status: "ACCEPTED" }),
    TestAssignment.countDocuments({ ...assignmentFilter, status: "DECLINED" }),
    TestAssignment.countDocuments({ ...assignmentFilter, status: "MISSED" }),
  ]);

  const attemptFilter = {
    status: { $in: ["SUBMITTED", "EVALUATED"] },
    ...(isAdmin ? {} : { testId: { $in: testIds }, studentId: { $in: studentIds } }),
  };

  const attempts = await TestAttempt.find(attemptFilter)
    .populate("studentId", "firstName lastName email")
    .populate({
      path: "testId",
      select: "title subjectIds",
      populate: { path: "subjectIds", select: "name" },
    })
    .sort({ submittedAt: -1, updatedAt: -1 })
    .limit(100)
    .lean();

  const todayAttempts = await TestAttempt.countDocuments({
    ...attemptFilter,
    submittedAt: { $gte: start, $lt: end },
  });

  const { performanceOverTime, subjectWiseTests, percentageOverTime } = buildEngagementMetrics(attempts);
  const recentTests = attempts.slice(0, 10).map((attempt) => ({
    id: attempt._id,
    studentName: getDisplayName(attempt.studentId),
    testName: attempt.testId?.title || "Untitled Test",
    score: Math.round(attempt.percentage || 0),
    date: attempt.submittedAt || attempt.updatedAt || attempt.createdAt,
  }));

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
  const assignmentCountBySeries = new Map(
    seriesAssignments.map((item) => [String(item._id), item.students]),
  );
  const completedTestIds = new Set(
    attempts
      .filter((attempt) => ["SUBMITTED", "EVALUATED"].includes(attempt.status))
      .map((attempt) => String(attempt.testId?._id || attempt.testId)),
  );
  const seriesColors = ["#3F5BF6", "#16A34A", "#F59E0B", "#A855F7", "#0891B2"];
  const testSeriesOverview = series.map((item, index) => {
    const scopedTests = isAdmin
      ? item.tests || []
      : (item.tests || []).filter((testId) =>
        testIds.some((scopedId) => String(scopedId) === String(testId)),
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
    percentageOverTime,
    recentTests,
    subjectWiseTests,
  };
};

export const getAdminDashboardData = async () => {
  return buildAdminOrgDashboardData({ isAdmin: true });
};

export const getOrganizationDashboardData = async (orgId, adminUserId) => {
  return buildAdminOrgDashboardData({ orgId, adminUserId, isAdmin: false });
};
