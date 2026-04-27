// export const rbacAccess = (allowedRoles) => {
//   // If no roles specified, allow all authenticated users
//   const roles = allowedRoles ? (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]) : null;

//   return (req, res, next) => {
//     const user = req.user;

//     if (!user) {
//       return res.status(401).json({
//         success: false,
//         message: "Unauthorized",
//       });
//     }

//     // Check if user role is in allowed roles (if specified)
//     if (roles && !roles.includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: "Forbidden: Insufficient permissions",
//       });
//     }

//     let filter = {};

//     switch (user.role) {
//       case "STUDENT":
//         // Student can only access their own data
//         filter = { _id: user._id };
//         break;

//       case "ORGANIZATION":
//         // Organization can only access students in their org
//         if (!user.organizationId) {
//           return res.status(400).json({
//             success: false,
//             message: "Organization ID missing",
//           });
//         }
//         filter = { organizationId: user.organizationId };
//         break;

//       case "IQPATH_ADMIN":
//       case "ADMIN":
//         // Admin has full access
//         filter = {};
//         break;

//       default:
//         return res.status(403).json({
//           success: false,
//           message: "Forbidden: Role not allowed",
//         });
//     }

//     // Attach filter for downstream controllers
//     req.accessFilter = filter;
//     next();
//   };
// };
export const rbacAccess = (allowedRoles = []) => {
  const roles = Array.isArray(allowedRoles)
    ? allowedRoles
    : [allowedRoles];

  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // 🔐 Role validation
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Insufficient permissions",
      });
    }

    let filter = {};

    switch (user.role) {
      case "STUDENT":
        // Student can access only their own record
        filter = { _id: user._id };
        break;

      case "ORGANIZATION":
        // Organization can access students under them
        filter = {
          role: "STUDENT",
          organization: user._id, // ✅ FIXED
        };
        break;

      case "ADMIN":
      case "IQPATH_ADMIN":
        // Full access
        filter = {};
        break;

      default:
        return res.status(403).json({
          success: false,
          message: "Forbidden: Role not supported",
        });
    }

    // Attach filter for controllers/services
    req.accessFilter = filter;

    next();
  };
};