import TestAttempt from "../../../models/testAttempt.model.js";
import User from "../../auth/models/User.model.js";
import Organization from "../../../models/organization.model.js";
import Test from "../../../models/test.model.js";
import HelpSupport from "../../help-support/helpSupport.model.js";
import UserSubscription from "../../subscription/models/UserSubscription.model.js";

export const getStudentDashboardData = async (studentId) => {
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
    };
  }

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

    // Accuracy Calculation
    const answers = attempt.answers || [];
    totalQuestionsAttempted += answers.length;
    totalCorrectAnswers += answers.filter((a) => a.isCorrect).length;

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
    const correctQ = answers.filter((a) => a.isCorrect).length;
    const wrongQ = answers.filter((a) => !a.isCorrect && a.selectedOption).length;
    const skippedQ = answers.filter((a) => !a.isCorrect && !a.selectedOption).length;

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

    let difficultyRaw = "Medium";
    if (attempt.testId && Array.isArray(attempt.testId.difficulty) && attempt.testId.difficulty.length > 0) {
      difficultyRaw = attempt.testId.difficulty[0];
    }
    const difficultyStr = difficultyRaw ? (difficultyRaw.charAt(0).toUpperCase() + difficultyRaw.slice(1).toLowerCase()) : "Medium";

    allTests.push({
      id: attempt.testId?._id || attempt.testId,
      resultId: attempt._id,
      name: testName,
      subject: subject,
      topic: primaryTopic,
      difficulty: difficultyStr,
      totalQuestions: totalQ,
      correct: correctQ,
      wrong: wrongQ,
      skipped: skippedQ,
      score: attempt.totalScore || 0,
      accuracy: percentage,
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
    tests: recentTests.slice(0, 10), // Limit to 10 recent tests for dashboard view
    allTests, // Contains ALL raw attempts for complex frontend filtering
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
  const weeklyMap = {};
  const monthlyMap = {};
  const subjectCountMap = {};
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const getWeekNumber = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  attempts.forEach((attempt) => {
    const submittedAt = attempt.submittedAt || attempt.updatedAt || attempt.createdAt || new Date();
    const date = new Date(submittedAt);
    const weekLabel = `Week ${getWeekNumber(date)}`;
    const monthLabel = monthNames[date.getMonth()];

    weeklyMap[weekLabel] = (weeklyMap[weekLabel] || 0) + 1;
    monthlyMap[monthLabel] = (monthlyMap[monthLabel] || 0) + 1;

    const subjects = attempt.testId?.subjectIds || [];
    if (Array.isArray(subjects) && subjects.length > 0) {
      subjects.forEach((subject) => {
        const name = subject?.name || "General";
        subjectCountMap[name] = (subjectCountMap[name] || 0) + 1;
      });
    } else {
      subjectCountMap.General = (subjectCountMap.General || 0) + 1;
    }
  });

  return {
    performanceOverTime: {
      weekly: Object.entries(weeklyMap).map(([label, count]) => ({ label, count })),
      monthly: Object.entries(monthlyMap).map(([label, count]) => ({ label, count })),
    },
    subjectWiseTests: Object.entries(subjectCountMap)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count),
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

  const [
    totalStudents,
    totalOrganizations,
    activeTests,
    activeAdminTests,
    activeOrgTests,
    completedTests,
    todayTests,
    scheduledTests,
    supportTotal,
    supportPending,
    supportCompleted,
    scopedTests,
    scopedStudents,
    planDistributionRaw,
  ] = await Promise.all([
    User.countDocuments(studentFilter),
    isAdmin ? Organization.countDocuments() : Promise.resolve(0),
    Test.countDocuments({ ...testFilter, status: "ACTIVE" }),
    isAdmin ? Test.countDocuments({ ...testFilter, status: "ACTIVE", "createdBy.role": "IQPATH_ADMIN" }) : Promise.resolve(0),
    isAdmin ? Test.countDocuments({ ...testFilter, status: "ACTIVE", "createdBy.role": "ORGANIZATION" }) : Promise.resolve(0),
    Test.countDocuments({ ...testFilter, status: "COMPLETED" }),
    Test.countDocuments(withTestFilter({
      $or: [
        { startTime: { $gte: start, $lt: end } },
        { createdAt: { $gte: start, $lt: end } },
      ],
    })),
    Test.countDocuments(withTestFilter({
      $or: [
        { status: "UPCOMING" },
        { scheduleType: { $in: ["DELAYED", "FIXED"] } },
      ],
    })),
    HelpSupport.countDocuments(supportFilter),
    HelpSupport.countDocuments({ ...supportFilter, status: "pending" }),
    HelpSupport.countDocuments({ ...supportFilter, status: "resolved" }),
    Test.find(testFilter).select("_id").lean(),
    User.find(studentFilter).select("_id").lean(),
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
    ])
  ]);

  const testIds = scopedTests.map((test) => test._id);
  const studentIds = scopedStudents.map((student) => student._id);
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

  const { performanceOverTime, subjectWiseTests } = buildEngagementMetrics(attempts);
  const recentTests = attempts.slice(0, 10).map((attempt) => ({
    id: attempt._id,
    studentName: getDisplayName(attempt.studentId),
    testName: attempt.testId?.title || "Untitled Test",
    score: Math.round(attempt.percentage || 0),
    date: attempt.submittedAt || attempt.updatedAt || attempt.createdAt,
  }));

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
      plans: planDistribution.students,
    },
    organizations: {
      total: totalOrganizations,
      plans: planDistribution.organizations,
    },
    tests: {
      totalActive: activeTests,
      activeAdmin: activeAdminTests,
      activeOrg: activeOrgTests,
      completed: completedTests,
      today: todayTests,
      scheduled: scheduledTests,
    },
    supportQueries: {
      total: supportTotal,
      pending: supportPending,
      completed: supportCompleted,
    },
    performanceOverTime,
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
