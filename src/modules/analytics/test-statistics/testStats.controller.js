import { fetchTestWiseStats } from "./testStats.service.js";

export const getTestStatsController = async (req, res, next) => {
  try {
    const { testId } = req.params;

    if (!testId) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required",
      });
    }

    const stats = await fetchTestWiseStats(testId);

    res.status(200).json({
      success: true,
      data: {
        testId,
        totalAttempts: stats.totalAttempts ?? 0,
        averageScore:
          stats.averageScore !== null && stats.averageScore !== undefined
            ? Number(stats.averageScore.toFixed(2))
            : 0,
        highestScore: stats.highestScore ?? 0,
        lowestScore: stats.lowestScore ?? 0,
        passCount: stats.passCount ?? 0,
        failCount: stats.failCount ?? 0,
      },
    });
  } catch (err) {
    // Ensure errors are passed to centralized error handler
    next(err);
  }
};
