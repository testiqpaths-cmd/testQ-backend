import { 
  getStudentDashboardData, 
  getAdminDashboardData, 
  getOrganizationDashboardData 
} from "./dashboard.service.js";

export const getStudentDashboardController = async (req, res, next) => {
  try {
    const studentId = req.user._id;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const dashboardData = await getStudentDashboardData(studentId);

    return res.status(200).json({
      success: true,
      message: "Dashboard data fetched successfully",
      data: dashboardData,
    });
  } catch (err) {
    next(err);
  }
};

export const getAdminDashboardController = async (req, res, next) => {
  try {
    const dashboardData = await getAdminDashboardData();
    return res.status(200).json({
      success: true,
      message: "Admin dashboard data fetched successfully",
      data: dashboardData,
    });
  } catch (err) {
    next(err);
  }
};

export const getOrganizationDashboardController = async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const adminUserId = req.user._id;
    const dashboardData = await getOrganizationDashboardData(orgId, adminUserId);
    return res.status(200).json({
      success: true,
      message: "Organization dashboard data fetched successfully",
      data: dashboardData,
    });
  } catch (err) {
    next(err);
  }
};
