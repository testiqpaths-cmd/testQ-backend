import * as service from "./test.service.js";
import logger from "../../config/logger.js";

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
    const test = await service.updateTest(req.test, req.body);
    res.json({ success: true, data: test });
  } catch (e) {
    next(e);
  }
}

export async function deleteTest(req, res, next) {
  try {
    await service.deleteTest(req.test);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

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