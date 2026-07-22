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
    const result = await service.getTestForViewerService(req.test, req.user);

    if (result.error) {
      return res.status(result.status).json({ success: false, message: result.error });
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
    const enriched = await service.getMyTests({ userId, search: req.query.search || "" });

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
    const leaderboard = req.query.leaderboard === "true";

    const tests = await service.getAllTests({ leaderboard, userId });

    return res.json({
      success: true,
      data: tests,
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

    const enriched = await service.getAssignedTests({
      search,
      userId,
      userRole: req.user?.role,
      studentId: userId,
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error(`getAssignedTests error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const publishTest = async (req, res, next) => {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const test = await service.publishTestService(req.test, req.user);
    res.json({ success: true, data: test });
  } catch (e) {
    next(e);
  }
};

export const acceptTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const assignment = await service.acceptTestAssignmentService(testId, studentId);

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const declineTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const assignment = await service.declineTestAssignmentService(testId, studentId);

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const pendingTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const assignment = await service.pendingTestAssignmentService(testId, studentId);

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const hideTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const assignment = await service.hideTestAssignmentService(testId, studentId);

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const startTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const result = await service.startTestAssignmentService(testId, studentId);

    if (result.error) {
      return res.status(result.status).json({ success: false, message: result.error });
    }

    res.json({ success: true, data: result.assignment });
  } catch (e) {
    next(e);
  }
};
