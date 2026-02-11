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

    if (!stats) {
      return res.status(404).json({
        success: false,
        message: "No attempts found for this test",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        testId,
        totalAttempts: stats.totalAttempts ?? 0,
        averageScore: stats.averageScore
          ? Number(stats.averageScore.toFixed(2))
          : 0,
        highestScore: stats.highestScore ?? 0,
        lowestScore: stats.lowestScore ?? 0,
        passCount: stats.passCount ?? 0,
        failCount: stats.failCount ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
};
