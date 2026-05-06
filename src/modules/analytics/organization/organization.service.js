
import { getOrganizationAnalyticsRepo } from "../repository/organization.repository.js";


export const getOrganizationAnalyticsService = async ({ orgId, startDate, endDate }) => {
  try {
    
    const analytics = await getOrganizationAnalyticsRepo({
      orgId,
      startDate,
      endDate,
    });

    
    return analytics;
  } catch (error) {
   
    console.error("Error in getOrganizationAnalyticsService:", error);

    throw new Error("Failed to fetch organization analytics");
  }
};
export const createOrganizationService = async (payload) => {
  return payload;
};