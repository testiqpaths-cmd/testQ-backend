// src/common/middlewares/plan.middleware.js
import { ApiError } from "../exceptions/ApiError.js";
import { PLANS } from "../constants/plans.js";

/**
 * Restrict access based on user plan
 * @param {Array} allowedPlans
 */
export const requirePlan = (allowedPlans = []) => {
  return (req, res, next) => {
    const userPlan = req.user?.plan;

    if (!userPlan) {
      throw new ApiError(403, "User plan not found");
    }

    if (!allowedPlans.includes(userPlan)) {
      throw new ApiError(
        403,
        `This feature is available for ${allowedPlans.join(", ")} users only`
      );
    }

    next();
  };
};
