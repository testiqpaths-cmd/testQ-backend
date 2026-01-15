import { verifyAccessToken } from "../../modules/auth/services/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";

/** Protect routes */
export const authMiddleware = (req, res, next) => {
  const token = req.cookies.accessToken;
  if (!token) throw new AuthError("Authentication required");

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded; // { id, role }
    next();
  } catch {
    throw new AuthError("Invalid or expired token");
  }
};

/** Role-based access control */
export const roleMiddleware = (...allowedRoles) => (req, res, next) => {
  if (!req.user) throw new AuthError("Unauthorized");
  if (!allowedRoles.includes(req.user.role)) throw new AuthError("Forbidden");
  next();
};
