import TestAttempt from "../../../models/testAttempt.model.js";

export const getStudentDashboardData = async (studentId) => {
  // Fetch all completed/submitted attempts for the student
  const attempts = await TestAttempt.find({
    studentId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  })
    .populate("testId", "title visibility type duration")
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

    // Subject/Topic Wise tests count (using snapshots if available, or just fallback)
    const topics = new Set();
    if (attempt.questionSnapshots) {
      attempt.questionSnapshots.forEach((q) => {
        if (q.topic) topics.add(q.topic);
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

    // Recent Tests format
    recentTests.push({
      id: attempt.testId?._id || attempt.testId,
      resultId: attempt._id,
      name: testName,
      category: attempt.testId?.type || "Standard",
      difficulty: "N/A", // Not always strictly defined
      attemptedAt: submittedAt,
      totalQuestions: attempt.questionSnapshots?.length || answers.length || 0,
      correctQuestions: answers.filter((a) => a.isCorrect).length,
      incorrectQuestions: answers.filter((a) => !a.isCorrect).length,
      percentage: percentage,
      timeTaken: `${attempt.duration || 0} minutes`,
      status: percentage >= 40 ? "pass" : "fail",
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
  };
};
