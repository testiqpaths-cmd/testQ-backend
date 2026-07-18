import * as service from "./test.service.js";
import logger from "../../config/logger.js";

const canManageTest = (test, user) => {
  if (!test || !user) return false;

  if (user.role === "IQPATH_ADMIN") return true;

  const ownerId =
    typeof test.createdBy?.userId === "object"
      ? test.createdBy?.userId?.toString?.()
      : String(test.createdBy?.userId || "");

  const requesterId = String(user._id || user.id || "");
  return ownerId && requesterId && ownerId === requesterId;
};

export const createTest = async (req, res) => {
  try {
    if (!req.user?._id && !req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const created = await service.createTest(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: "Test created successfully",
      data: created,
    });
  } catch (err) {
    logger.error(`createTest error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export async function getTest(req, res) {
  try {
    if (req.user?.role === "STUDENT") {
      const User = (await import("../../modules/auth/models/User.model.js")).default;
      const dbUser = await User.findById(req.user._id || req.user.id).select("createdAt");
      if (dbUser && req.test?.createdAt && new Date(req.test.createdAt) < new Date(dbUser.createdAt)) {
        return res.status(403).json({
          success: false,
          message: "You cannot access a test created before your registration date",
        });
      }
    }
    res.json({ success: true, data: req.test });
  } catch (err) {
    logger.error(`getTest error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateTest(req, res, next) {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const test = await service.updateTest(req.test, req.body, req.user);
    res.json({ success: true, data: test });
  } catch (e) {
    next(e);
  }
}

export async function deleteTest(req, res, next) {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await service.deleteTest(req.test);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export const getMyTests = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const tests = await service.getMyTests({ userId, search: req.query.search || "" });

    // Attach attemptsMade and override status for UI when maxAttempts reached
    const TestAttempt = (await import("../../models/testAttempt.model.js")).default;

    const enriched = await Promise.all(
      tests.map(async (t) => {
        const attemptsMade = await TestAttempt.countDocuments({ testId: t._id, studentId: userId });
        // count evaluated attempts (results) for this test across all students
        const evaluatedCount = await TestAttempt.countDocuments({ testId: t._id, status: 'EVALUATED' });
        const obj = t.toObject ? t.toObject() : { ...t };
        obj.attemptsMade = attemptsMade;
        obj.hasResults = evaluatedCount > 0;
        if (Number(obj.maxAttempts || 1) <= attemptsMade) {
          // For UI purposes mark as completed so no Start button shows
          obj.status = 'COMPLETED';
        }
        return obj;
      })
    );

    return res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error(`getMyTests error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const getAllTests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const tests = req.query.leaderboard === "true"
      ? await service.getLeaderboardTests()
      : await service.getAllTests();

    // Attach attemptsMade for each test (current student's perspective)
    if (userId) {
      const TestAttempt = (await import("../../models/testAttempt.model.js")).default;
      const enriched = await Promise.all(
        tests.map(async (t) => {
          const attemptsMade = await TestAttempt.countDocuments({ 
            testId: t._id, 
            studentId: userId,
            status: { $in: ['SUBMITTED', 'EVALUATED'] }
          });
          const obj = t.toObject ? t.toObject() : { ...t };
          obj.attemptsMade = attemptsMade;
          return obj;
        })
      );
      return res.json({
        success: true,
        data: enriched
      });
    }

    return res.json({
      success: true,
      data: tests
    });
  } catch (err) {
    logger.error(`getAllTests error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

export const getAssignedTests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const search = req.query.search || "";

    let userCreatedAt = null;
    if (userId && req.user?.role === "STUDENT") {
      const User = (await import("../../modules/auth/models/User.model.js")).default;
      const dbUser = await User.findById(userId).select("createdAt");
      if (dbUser) {
        userCreatedAt = dbUser.createdAt;
      }
    }

    const tests = await service.getAssignedTests({ search, userCreatedAt });

    // Attach current user's attempt count so the UI can hide Start when attempts are exhausted.
    const TestAttempt = (await import("../../models/testAttempt.model.js")).default;

    const enriched = await Promise.all(
      tests.map(async (test) => {
        const attemptsMade = userId
          ? await TestAttempt.countDocuments({ testId: test._id, studentId: userId })
          : 0;

        const obj = test.toObject ? test.toObject() : { ...test };
        obj.attemptsMade = attemptsMade;

        if (Number(obj.maxAttempts || 1) <= attemptsMade) {
          obj.status = "COMPLETED";
        }

        return obj;
      })
    );

    return res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error(`getAssignedTests error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};