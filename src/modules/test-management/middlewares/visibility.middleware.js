export default function visibilityMiddleware(req, res, next) {
  const { visibility, allowedOrganizations, testCode } = req.test;
  const user = req.user;

  if (visibility === "PUBLIC") return next();

  if (visibility === "ORG_ONLY" && allowedOrganizations?.includes(user.organizationId)) return next();

  if (visibility === "LINK_ONLY" && req.query.code === testCode) return next();

  return res.status(403).json({ message: "Access denied" });
}
