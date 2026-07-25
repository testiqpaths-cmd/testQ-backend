import {
  getStudentDashboardData,
  getAdminDashboardData,
  getOrganizationDashboardData
} from "./dashboard.service.js";
import UserModel from "../../../models/user.model.js";

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
    // Fall back to a DB lookup for tokens issued before organizationId was
    // embedded in the JWT payload — without this, orgId is silently null and
    // every "own org" filter downstream (student count, etc.) drops out,
    // returning platform-wide totals instead of this organization's data.
    let orgId = req.user.organizationId || null;
    if (!orgId) {
      const dbUser = await UserModel.findById(req.user._id).select("organizationId").lean();
      orgId = dbUser?.organizationId ?? null;
    }
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
