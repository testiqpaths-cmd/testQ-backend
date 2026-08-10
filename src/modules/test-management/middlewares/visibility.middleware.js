export default function visibilityMiddleware(req, res, next) {
  const { visibility, allowedOrganizations, allowedStudents, testCode, createdBy } = req.test;
  const user = req.user;

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

  // 3. Visibility rules for regular students/users
  if (visibility === "PUBLIC") return next();

  if (visibility === "ORG_ONLY" && user.organizationId) {
    const isAllowed = allowedOrganizations?.some(
      (orgId) => orgId.toString() === user.organizationId.toString()
    );
    if (isAllowed) return next();
  }

  if (visibility === "LINK_ONLY" && req.query.code === testCode) return next();

  if (visibility === "SELECT_STUDENT") {
    const isAllowed = allowedStudents?.some(
      (studentId) => studentId.toString() === requesterId
    );
    if (isAllowed) return next();
  }

  return res.status(403).json({ message: "Access denied" });
}
