import TestAttempt from "../../../models/testAttempt.model.js";

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
