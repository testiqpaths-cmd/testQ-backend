import crypto from "crypto";
import { ApiError } from "../exceptions/ApiError.js";
import { checkFeatureAccess } from "../../modules/subscription/services/subscription.service.js";

/**
 * Middleware to restrict access based on feature availability in the user's plan.
 * @param {string} featureKey - The unique key of the feature to check (e.g., 'IQ_ROOM', 'CREATE_TEST')
 * @param {boolean} incrementUsage - Whether to increment the usage count for this feature on this request
 */
export const featureMiddleware = (featureKey, incrementUsage = false) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?._id;

      if (!userId) {
        throw new ApiError(401, "Unauthorized access. User not found.");
      }

      const reservationId = incrementUsage ? crypto.randomUUID() : null;

      // Check if user has access (will throw ApiError 402 if denied/limit reached)
      await checkFeatureAccess(
        userId,
        featureKey,
        incrementUsage ? 1 : 0,
        reservationId
      );

      if (reservationId) {
        req.featureReservation = {
          reservationId,
          featureKey,
          userId,
          count: 1,
          released: false,
        };
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
