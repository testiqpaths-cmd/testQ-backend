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
  res.json({ success: true, data: req.test });
}

export async function updateTest(req, res, next) {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const test = await service.updateTest(req.test, req.body);
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
    const tests = await service.getMyTests({
      userId: req.user._id || req.user.id,
      search: req.query.search || "",
    });

    return res.json({
      success: true,
      data: tests,
    });
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
    const tests = await service.getAllTests();

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