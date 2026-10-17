import TestAssignment from "../../../models/testAssignment.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";
import TestSeriesAssignment from "../../../models/testSeriesAssignment.model.js";

export default async function visibilityMiddleware(req, res, next) {
  try {
    const { visibility, allowedOrganizations, allowedStudents, testCode, createdBy, testSeriesId } = req.test;
    const user = req.user || {};

    // 1. Admins have universal access
    if (user.role === "IQPATH_ADMIN") return next();

    // 2. The creator of the test always has access
    const ownerId = typeof createdBy?.userId === "object"
      ? createdBy?.userId?.toString?.()
      : String(createdBy?.userId || "");
    const requesterId = String(user._id || user.id || "");
    
    if (ownerId && requesterId && ownerId === requesterId) {
      return next();
    }

    // 3. User has an active assignment, series assignment, or existing attempt for this test
    if (requesterId) {
      const assignment = await TestAssignment.findOne({
        testId: req.test._id,
        studentId: requesterId,
        status: { $ne: "DECLINED" },
      }).lean();
      if (assignment) return next();

      const hasAttempt = await TestAttempt.exists({
        testId: req.test._id,
        studentId: requesterId,
      });
      if (hasAttempt) return next();

      if (testSeriesId) {
        const seriesAssignment = await TestSeriesAssignment.findOne({
          seriesId: testSeriesId,
          studentId: requesterId,
          status: { $ne: "DECLINED" },
        }).lean();
        if (seriesAssignment) return next();
      }
    }

    // 4. Public and Link-only tests are accessible by whoever has the test link/id
    if (visibility === "PUBLIC" || visibility === "LINK_ONLY") {
      return next();
    }

    // 5. Organization only visibility
    if (visibility === "ORG_ONLY" && user.organizationId) {
      const isAllowed = allowedOrganizations?.some(
        (orgId) => orgId.toString() === user.organizationId.toString()
      );
      if (isAllowed) return next();
    }

    // 6. Select student visibility
    if (visibility === "SELECT_STUDENT") {
      const isAllowed = allowedStudents?.some(
        (studentId) => studentId.toString() === requesterId
      );
      if (isAllowed) return next();
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (err) {
    next(err);
  }
}

