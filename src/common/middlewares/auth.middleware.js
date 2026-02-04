import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";
import User from "../../models/user.model.js";
import jwt from "jsonwebtoken";
import env from "../../config/env.js";
/** Protect routes */
export const authMiddleware = (req, res, next) => {
  try {
    const token = req.cookies?.accessToken; // ✅ IMPORTANT (match login cookie)

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        errors: null,
      });
    }

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    //console.log("decoded:", decoded);


    // ✅ set req.user (include orgId if you have it in token)
    req.user = {
      _id: decoded.id,              // or decoded._id depending on your token payload
      role: decoded.role,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      errors: null,
    });
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
