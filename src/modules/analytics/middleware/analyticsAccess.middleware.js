export const analyticsAccess = (req, res, next) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  switch (user.role) {
    case "STUDENT":
      req.analyticsFilter = {
        studentId: user._id,
      };
      break;

    case "ORGANIZATION":
      req.analyticsFilter = {
        organizationId: user.organizationId,
      };
      break;

    case "IQPATH_ADMIN":
      req.analyticsFilter = {}; // Full access
      break;

    default:
      return res.status(403).json({
        success: false,
        message: "Forbidden: Role not allowed for analytics",
      });
  }

  next();
};
