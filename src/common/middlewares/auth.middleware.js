import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";
import User from "../../models/user.model.js";

/** Protect routes */
export const authMiddleware = async (req, res, next) => {
  const token = req.cookies.accessToken;

  if (!token) {
    return next(new AuthError("Authentication required"));
  }

  try {
    const decoded = verifyAccessToken(token); // { id, role }

    const user = await User.findById(decoded.id)
      .select("_id role organizationId");

    if (!user) {
      return next(new AuthError("User not found"));
    }

    req.user = user;
    next();
  } catch (err) {
    next(new AuthError("Invalid or expired token"));
  }
};

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
