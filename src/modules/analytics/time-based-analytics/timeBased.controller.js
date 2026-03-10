import { getTimeBasedTrends } from "./timeBased.service.js";
import { validateTrendFilters } from "./timeBased.validation.js";

export const getTimeBasedAnalytics = async (req, res, next) => {
  try {
    const filters = validateTrendFilters(req.query);
    const result = await getTimeBasedTrends(filters);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
