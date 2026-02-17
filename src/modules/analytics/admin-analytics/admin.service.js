import {
  countStudents,
  countTests,
  countAttempts,
  getAverageScore,
  getTopPerformingTests,
} from "../repository/admin.repository.js";

export const getPlatformAnalyticsService = async () => {
  try {
    const [
      totalStudents,
      totalTests,
      totalAttempts,
      averageScore,
      topPerformingTests,
    ] = await Promise.all([
      countStudents(),
      countTests(),
      countAttempts(),
      getAverageScore(),
      getTopPerformingTests(),
    ]);

    return {
      overview: {
        totalStudents: totalStudents || 0,
        totalTests: totalTests || 0,
        totalAttempts: totalAttempts || 0,
        averageScore: averageScore
          ? Number(averageScore.toFixed(2))
          : 0,
      },
      topPerformingTests: topPerformingTests || [],
    };
  } catch (error) {
    console.error("Error in getPlatformAnalyticsService:", error);

    // Fail gracefully with safe defaults
    return {
      overview: {
        totalStudents: 0,
        totalTests: 0,
        totalAttempts: 0,
        averageScore: 0,
      },
      topPerformingTests: [],
    };
  }
};
