import User from "../../../models/user.model.js";
import Organization from "../../../models/organization.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getPlatformStats = async (startDate, endDate) => {
  try {
    // None of these five queries depend on each other's result — running
    // them sequentially was paying for 5 round-trips back to back instead
    // of one.
    const [totalUsers, totalOrganizations, totalAttempts, avgScoreData, statusBreakdown] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      TestAttempt.countDocuments(),
      // ✅ Average score with date filter + projection
      TestAttempt.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $project: { percentage: 1 } },
        { $group: { _id: null, avgScore: { $avg: "$percentage" } } }
      ]),
      // ✅ Pass/Fail breakdown with date filter
      TestAttempt.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $project: { resultStatus: 1 } },
        { $group: { _id: "$resultStatus", count: { $sum: 1 } } }
      ]),
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
