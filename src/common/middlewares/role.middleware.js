import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";

/** Role-based access control */
export const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthError("Unauthorized"));
    }
    

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AuthError("Forbidden"));
    }

    next();
  };
};
