import Organization from "../../../models/organization.model.js";
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

export const getOrganizations = async (req, res, next) => {
  try {
    const organizations = await Organization.find({})
      .select("name code address contactEmail createdAt")
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: organizations,
    });
  } catch (error) {
    next(error);
  }
};
