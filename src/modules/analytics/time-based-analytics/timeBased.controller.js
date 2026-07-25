import { getTimeBasedTrends } from "./timeBased.service.js";
import { validateTrendFilters } from "./timeBased.validation.js";
import UserModel from "../../../models/user.model.js";

export const getTimeBasedAnalytics = async (req, res, next) => {
  try {
    const filters = validateTrendFilters(req.query);

    // organizationId is a free client-supplied query param; for an
    // ORGANIZATION-role caller it must always be their own org, never
    // whatever value was passed in, or they could read another org's trends.
    if (req.user?.role === "ORGANIZATION") {
      let orgId = req.user.organizationId || null;
      if (!orgId) {
        const dbUser = await UserModel.findById(req.user._id).select("organizationId").lean();
        orgId = dbUser?.organizationId ?? null;
      }
      filters.organizationId = orgId;
    }

    const result = await getTimeBasedTrends(filters);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
