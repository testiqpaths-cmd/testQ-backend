import { getPlatformAnalyticsService } from "./admin.service.js";

export const getPlatformAnalytics = async (req, res, next) => {
  try {
    const data = await getPlatformAnalyticsService();

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching platform analytics:", error);
    next(error); // handled by centralized error middleware
  }
};
