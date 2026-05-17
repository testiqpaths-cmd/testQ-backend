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

      req.user = {
        _id: decoded.id,
        role: decoded.role,
        organizationId: decoded.organizationId ?? null,
      };

      return next();
    } catch (e) {
      logger.debug(`auth.middleware: backend JWT verify failed: ${e.message}`);
      // Not a backend JWT — try Firebase ID token
    }

    // Try verifying as Firebase ID token
    try {
      const firebaseAuth = getFirebaseAuth();
      logger.debug(`auth.middleware: attempting Firebase verify for token length=${token?.length}`);
      const fbDecoded = await firebaseAuth.verifyIdToken(token);

      // fbDecoded contains uid, email, name, picture, email_verified
      const uid = fbDecoded.uid;
      const email = fbDecoded.email;

      let user = null;
      if (uid) {
        user = await User.findOne({ firebaseUid: uid });
      }

      if (!user && email) {
        user = await User.findOne({ email: email.toLowerCase() });
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
