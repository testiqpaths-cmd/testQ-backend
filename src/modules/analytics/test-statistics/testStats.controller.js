import { fetchTestWiseStats } from "./testStats.service.js";
import Test from "../../../models/test.model.js";
import UserModel from "../../../models/user.model.js";

export const getTestStatsController = async (req, res, next) => {
  try {
    const { testId } = req.params;

    if (!testId) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required",
      });
    }

    // An ORGANIZATION-role caller may only view stats for tests their own
    // org created — otherwise any org could probe another org's pass/fail
    // rate for a test just by guessing its id.
    if (req.user?.role === "ORGANIZATION") {
      const test = await Test.findById(testId).select("createdBy").lean();
      if (!test) {
        return res.status(404).json({ success: false, message: "Test not found" });
      }
      let requesterOrgId = req.user.organizationId ? String(req.user.organizationId) : null;
      if (!requesterOrgId) {
        const dbUser = await UserModel.findById(req.user._id).select("organizationId").lean();
        requesterOrgId = dbUser?.organizationId ? String(dbUser.organizationId) : null;
      }
      const creator = await UserModel.findById(test.createdBy?.userId).select("organizationId").lean();
      const testOrgId = creator?.organizationId ? String(creator.organizationId) : null;
      if (!requesterOrgId || !testOrgId || requesterOrgId !== testOrgId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    const stats = await fetchTestWiseStats(testId);

    res.status(200).json({
      success: true,
      data: {
        testId,
        totalAttempts: stats.totalAttempts ?? 0,
        averageScore:
          stats.averageScore !== null && stats.averageScore !== undefined
            ? Number(stats.averageScore.toFixed(2))
            : 0,
        highestScore: stats.highestScore ?? 0,
        lowestScore: stats.lowestScore ?? 0,
        passCount: stats.passCount ?? 0,
        failCount: stats.failCount ?? 0,
      },
    });
  } catch (err) {
    // Ensure errors are passed to centralized error handler
    next(err);
  }
};
