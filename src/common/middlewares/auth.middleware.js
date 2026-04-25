import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";

/** Protect routes */
export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    const headerToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;

    // Header first, then cookie fallback.
    const token = headerToken || req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        errors: null,
      });
    }

    
    const decoded = verifyAccessToken(token); // { id, role }

    req.user = {
      _id: decoded.id,
      role: decoded.role,
      organizationId: decoded.organizationId ?? null,
    };

    next();
  } catch (err) {
    return next(new AuthError("Invalid or expired token"));
  }
};
