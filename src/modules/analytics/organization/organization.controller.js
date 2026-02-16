import { getOrganizationAnalyticsService } from "./organization.service.js";


export const getOrganizationAnalytics = async (req, res, next) => {
  try {
    // Extract organization ID from route parameters
    const { orgId } = req.params;

    // Extract optional date range filters from query parameters
    const { startDate, endDate } = req.query;

    const data = await getOrganizationAnalyticsService({
      orgId,
      startDate,
      endDate,
    });

    
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};
