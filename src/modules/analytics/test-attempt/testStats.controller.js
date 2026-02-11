import { fetchTestWiseStats } from "./testStats.service.js";

export const getTestStatsController = async (req, res, next) => {
  try {
    const { testId } = req.params;

    const stats = await fetchTestWiseStats(testId);

    if (!stats) {
      return res.status(404).json({
        success: false,
        message: "No attempts found for this test",
      });
    }

    res.json({
      success: true,
      data: {
        testId: stats._id,
        totalAttempts: stats.totalAttempts,
        averageScore: Number(stats.averageScore.toFixed(2)),
        highestScore: stats.highestScore,
        lowestScore: stats.lowestScore,
        passCount: stats.passCount,
        failCount: stats.failCount,
      },
    });
  } catch (err) {
    next(err);
  }
};
