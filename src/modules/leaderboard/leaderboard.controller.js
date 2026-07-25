import * as leaderboardService from "./leaderboard.service.js";

// 🧪 TEST
export const getTestLeaderboard = async (req, res, next) => {
  try {
    const data = await leaderboardService.getTestLeaderboard(
      req.params.testId,
      req.query,
      req.user
    );

    res.json({
      success: true,
      message: "Test leaderboard fetched successfully",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// 📚 SERIES
export const getSeriesLeaderboard = async (req, res, next) => {
  try {
    const data = await leaderboardService.getSeriesLeaderboard(
      req.params.seriesId,
      req.query,
      req.user
    );

    res.json({
      success: true,
      message: "Series leaderboard fetched successfully",
      data,
    });
  } catch (err) {
    next(err);
  }
};