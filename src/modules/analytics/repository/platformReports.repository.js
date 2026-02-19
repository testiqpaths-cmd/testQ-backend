import User from "../../../models/user.model.js";
import Organization from "../../../models/organization.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getPlatformStats = async (startDate, endDate) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalOrganizations = await Organization.countDocuments();
    const totalAttempts = await TestAttempt.countDocuments();

    // ✅ Average score with date filter + projection
    const avgScoreData = await TestAttempt.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $project: { percentage: 1 } },
      { $group: { _id: null, avgScore: { $avg: "$percentage" } } }
    ]);

    // ✅ Pass/Fail breakdown with date filter
    const statusBreakdown = await TestAttempt.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $project: { resultStatus: 1 } },
      { $group: { _id: "$resultStatus", count: { $sum: 1 } } }
    ]);

    return {
      totalUsers,
      totalOrganizations,
      totalAttempts,
      averageScore: avgScoreData[0]?.avgScore || 0,
      passCount: statusBreakdown.find(s => s._id === "PASS")?.count || 0,
      failCount: statusBreakdown.find(s => s._id === "FAIL")?.count || 0,
      generatedAt: new Date(),
    };
  } catch (err) {
    console.error("Error fetching platform stats:", err);
    return null;
  }
};
