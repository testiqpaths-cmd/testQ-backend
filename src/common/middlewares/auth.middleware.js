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

/** Protect routes */
export const authMiddleware = (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    req.headers.authorization?.split(" ")[1];

  if (!token) {
    return next(new AuthError("Authentication required"));
  }

  try {
    const decoded = verifyAccessToken(token); // { id, role }

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
