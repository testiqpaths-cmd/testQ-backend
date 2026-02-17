import { getTrendAnalyticsRepo } from "../repository/timeBased.repository.js";
export const getTimeBasedTrends = async (filters) => {
  try {
    const trends = await getTrendAnalyticsRepo(filters);
    return { trends };
  } catch (error) {
    console.error("Error in getTimeBasedTrends:", error);
    return { trends: [] };
  }
};
