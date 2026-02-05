import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";

/** Protect routes */
export const authMiddleware = (req, res, next) => {
  try {
    // cookie token (your frontend uses withCredentials)
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        errors: null,
      });
    }

    // ✅ YOU MISSED THIS LINE
    const decoded = verifyAccessToken(token); // { id, role }

    // ✅ normalize user object
    req.user = {
      _id: decoded.id,
      role: decoded.role,
    };

    next();
  } catch (err) {
    return next(new AuthError("Invalid or expired token"));
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
