// import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
// import { AuthError } from "../exceptions/AuthError.js";

// /** Protect routes */
// export const authMiddleware = (req, res, next) => {
//   const token = req.cookies.accessToken;
//   if (!token) throw new AuthError("Authentication required");

//   try {
//     const decoded = verifyAccessToken(token);
//     req.user = decoded; // { id, role }
//     next();
//   } catch {
//     throw new AuthError("Invalid or expired token");
//   }
// };

// /** Role-based access control */
// export const roleMiddleware = (...allowedRoles) => (req, res, next) => {
//   if (!req.user) throw new AuthError("Unauthorized");
//   if (!allowedRoles.includes(req.user.role)) throw new AuthError("Forbidden");
//   next();
// };
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

    // ✅ normalize user object for services
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
