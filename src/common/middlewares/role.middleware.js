import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";
import { ApiError } from "../exceptions/ApiError.js";

/** Role-based access control */
export const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthError("Unauthorized"));
    }
    

    // 403, not 401: the user IS authenticated, just not allowed here. The
    // frontend treats any 401 as an expired session (refresh, then log out
    // if refresh fails), so a 401 here logs users out on role mismatches.
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, "Forbidden"));
    }

    next();
  };
};
