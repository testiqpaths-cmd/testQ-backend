import { getStudentDashboardData } from "./dashboard.service.js";

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
