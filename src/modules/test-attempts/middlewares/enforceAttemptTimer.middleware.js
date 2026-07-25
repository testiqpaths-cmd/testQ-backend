// src/modules/testAttempts/middlewares/enforceAttemptTimer.middleware.js
import TestAttempt from "../../../models/testAttempt.model.js";
import UserModel from "../../../models/user.model.js";
import { computeAttemptTiming } from "../utils/attemptTimer.util.js";
import {
  autoExpireAttempt,
  checkAttemptExpiry,
} from "../services/attemptTimer.service.js";

// ORGANIZATION callers may only touch attempts belonging to their own
// org's students — used to be "ADMIN / ORG for any attempt", which let any
// org account read or (via manualevaluate) mutate another org's student's
// in-progress/submitted attempt.
const isOwnOrgStudent = async (requester, studentId) => {
  let orgId = requester.organizationId || null;
  if (!orgId) {
    const dbUser = await UserModel.findById(requester._id).select("organizationId").lean();
    orgId = dbUser?.organizationId ?? null;
  }
  if (!orgId) return false;
  const student = await UserModel.findById(studentId).select("organizationId").lean();
  return Boolean(student?.organizationId && String(student.organizationId) === String(orgId));
};

/**
 * Load attempt from database
 * Validates that the attempt exists and belongs to the authenticated user
 */
// export const loadAttempt = async (req, res, next) => {
//   try {
//     const { attemptId } = req.params;
//     const userId = req.user?._id;

//     const attempt = await TestAttempt.findById(attemptId);

//     if (!attempt) {
//       return res.status(404).json({
//         success: false,
//         message: "Attempt not found",
//       });
//     }

//     // Verify ownership (optional but recommended for security)
//     if (attempt.studentId.toString() !== userId.toString()) {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized: This is not your attempt",
//       });
//     }

//     req.attempt = attempt;
//     return next();
//   } catch (err) {
//     return next(err);
//   }
// };

export const loadAttempt = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;

    const attempt = await TestAttempt.findById(attemptId);

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found",
      });
    }

    // ✅ Student: only their own attempt.
    // ✅ IQPATH_ADMIN: any attempt.
    // ✅ ORGANIZATION: only attempts belonging to their own org's students.
    if (userRole === "STUDENT" && attempt.studentId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: This is not your attempt",
      });
    }

    if (userRole === "ORGANIZATION" && !(await isOwnOrgStudent(req.user, attempt.studentId))) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: This attempt does not belong to your organization",
      });
    }

    req.attempt = attempt;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Enforce timer by checking if time has expired
 * If expired, auto-expires the attempt and prevents further actions
 *
 * ✅ Ensures backend time is the source of truth
 * ✅ Frontend timer is display-only
 */
export const enforceAttemptTimer = async (req, res, next) => {
  try {
    const attempt = req.attempt;

    // If attempt is not in progress, skip expiry check
    if (attempt.status !== "IN_PROGRESS") {
      const isActuallyExpired = attempt.status === "EXPIRED";

      req.timing = {
        remainingSeconds: 0,
        remainingMs: 0,
        expired: isActuallyExpired, // ✅ FIX: true if status is EXPIRED
        ended: true,
        endReason: attempt.expireReason || attempt.status,
        serverNow: new Date(),
      };
      return next();
    }

    // Calculate remaining time using backend logic only
    const timing = computeAttemptTiming(attempt);
    req.timing = timing;

    // If not expired, proceed normally
    if (!timing.expired) {
      return next();
    }

    // ✅ Time is up: auto-expire the attempt
    await autoExpireAttempt(attempt, "TIME_EXPIRED");

    // Refresh attempt for downstream controllers
    const updated = await TestAttempt.findById(attempt._id);
    req.attempt = updated;
    req.timing = {
      remainingSeconds: 0,
      remainingMs: 0,
      expired: true,
      ended: true,
      endReason: updated.expireReason || "TIME_EXPIRED",
      serverNow: new Date(),
    };

    return next();
  } catch (err) {
    return next(err);
  }
};
