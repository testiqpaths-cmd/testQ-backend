export default function visibilityMiddleware(req, res, next) {
  const { visibility, allowedOrganizations, testCode, createdBy } = req.test;
  const user = req.user;

  if (user.role === "IQPATH_ADMIN") return next();

  const ownerId = createdBy?.userId?.toString();
  const requesterId = String(user._id || user.id || "");
  if (ownerId && requesterId && ownerId === requesterId) {
    return next();
  }

  if (visibility === "PUBLIC") return next();

  if (visibility === "ORG_ONLY" && user.organizationId) {
    const isAllowed = allowedOrganizations?.some(
      (orgId) => orgId.toString() === user.organizationId.toString()
    );
    if (isAllowed) return next();
  }

  if (visibility === "LINK_ONLY" && req.query.code === testCode) return next();

  return res.status(403).json({ message: "Access denied" });
}
