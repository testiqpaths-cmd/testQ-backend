import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../exceptions/AuthError.js";
import { getAuth as getFirebaseAuth } from "../../firebase/firebaseAdmin.js";
import User from "../../modules/auth/models/User.model.js";
import logger from "../../config/logger.js";

/** Protect routes */
export const authMiddleware = async (req, res, next) => {
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

    try {
      const decoded = verifyAccessToken(token); // backend JWT
      logger.debug(`auth.middleware: backend JWT verified id=${decoded.id}`);

      const dbUser = await User.findById(decoded.id).select("status role organizationId");
      if (!dbUser) {
        return res.status(401).json({
          success: false,
          message: "User not found",
        });
      }
      if (dbUser.status === "SUSPENDED") {
        return res.status(403).json({
          success: false,
          message: "Your account is blocked. Please contact admin.",
        });
      }

      req.user = {
        _id: decoded.id,
        role: decoded.role,
        organizationId: decoded.organizationId ?? null,
      };

      return next();
    } catch (e) {
      logger.debug(`auth.middleware: backend JWT verify failed: ${e.message}`);
      if (e.name === "TokenExpiredError" || e.message?.includes("jwt expired")) {
        return res.status(401).json({
          success: false,
          message: "Token expired",
          code: "TOKEN_EXPIRED",
        });
      }
      // Not an expired backend JWT — check if it is a Firebase ID token
    }

    // Only attempt Firebase verification if token was issued by Google/Firebase
    const unverified = jwt.decode(token);
    const isFirebaseToken = Boolean(
      unverified &&
      typeof unverified === "object" &&
      typeof unverified.iss === "string" &&
      unverified.iss.startsWith("https://securetoken.google.com/")
    );

    if (!isFirebaseToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
        errors: null,
      });
    }

    // Try verifying as Firebase ID token with 5s timeout to avoid request stalling
    try {
      const firebaseAuth = getFirebaseAuth();
      logger.debug(`auth.middleware: attempting Firebase verify for token length=${token?.length}`);
      const verifyPromise = firebaseAuth.verifyIdToken(token);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Firebase verification timed out")), 5000)
      );
      const fbDecoded = await Promise.race([verifyPromise, timeoutPromise]);

      // fbDecoded contains uid, email, name, picture, email_verified
      const uid = fbDecoded.uid;
      const email = fbDecoded.email;

      let user = null;
      if (uid) {
        user = await User.findOne({ firebaseUid: uid }).setOptions({ includeDeleted: true });
      }

      if (!user && email) {
        user = await User.findOne({ email: email.toLowerCase() }).setOptions({ includeDeleted: true });
      }

      if (user && user.isDeleted) {
        user.isDeleted = false;
        user.deletedAt = null;
        user.deletedBy = null;
        user.status = "ACTIVE";
        await user.save();
      }

      if (!user) {
        // Auto-provision a minimal user account for Firebase login
        const names = (fbDecoded.name || "").split(" ");
        const firstName = names.shift() || "";
        const lastName = names.join(" ") || "";

        // Create with a random password (not used for Firebase logins)
        const randomPassword = Math.random().toString(36).slice(-12);

        user = await User.create({
          firstName: firstName || "User",
          lastName: lastName || "",
          email: email ? email.toLowerCase() : `fb_${uid}@example.com`,
          firebaseUid: uid,
          password: randomPassword,
          role: "STUDENT",
          status: "ACTIVE",
          isEmailVerified: !!fbDecoded.email_verified,
          emailVerifiedAt: fbDecoded.email_verified ? new Date() : null,
        });
      } else if (!user.firebaseUid && uid) {
        user.firebaseUid = uid;
        await user.save();
      }

      if (user && user.status === "SUSPENDED") {
        return res.status(403).json({
          success: false,
          message: "Your account is blocked. Please contact admin.",
        });
      }

      // Attach minimal user info expected by downstream code
      req.user = {
        _id: user._id,
        id: user._id,
        role: user.role,
        organizationId: user.organizationId ?? null,
      };

      return next();
    } catch (fbErr) {
      return next(new AuthError("Invalid or expired token"));
    }
  } catch (err) {
    return next(new AuthError("Invalid or expired token"));
  }
};
