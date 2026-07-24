import * as service from "./testSeries.service.js";
import logger from "../../config/logger.js";
import mongoose from "mongoose";
import TestSeries from "../../models/testSeries.model.js";
import { broadcastAssignedTestsChanged } from "../notification/notification.service.js";

// export const createSeries = async (req, res) => {
//   const series = await service.createSeries(req.body, req.user);
//   res.status(201).json({ success: true, data: series });

// };

export const createSeries = async (req, res, next) => {
  try {
    const { title, description, visibility, tests = [] } = req.body;

    if (!title?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Title is required" });
    }

    // ✅ validate test ids (prevents mongoose crash)
    const cleanedTests = (Array.isArray(tests) ? tests : []).filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );

    const series = await service.createSeries(
      {
        title: title.trim(),
        description: description?.trim() || "",
        visibility,
        tests: cleanedTests,
      },
      req.user
    );

    return res.status(201).json({
      success: true,
      message: "Test series created successfully",
      data: series,
    });
  } catch (err) {
    logger.error(`createSeries error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const updateSeries = async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body || {};

    const series = await service.updateSeries(id, payload);

    // If client requested schedule update, compute start/end for tests
    if (Array.isArray(payload.tests) && payload.scheduleStart) {
      const Test = (await import('../../models/test.model.js')).default;

      // parse scheduleStart
      let cursor = new Date(payload.scheduleStart);
      if (Number.isNaN(cursor.getTime())) cursor = new Date();

      for (const testId of payload.tests) {
        try {
          const test = await Test.findById(testId);
          if (!test) continue;

          const durationMinutes = Number(test.duration) || 0;
          const startTime = new Date(cursor);
          const endTime = new Date(cursor.getTime() + durationMinutes * 60 * 1000);

          test.startTime = startTime;
          test.endTime = endTime;
          await test.save();

          // advance cursor
          cursor = endTime;
        } catch (e) {
          // continue on per-test error
          logger.error(`updateSeries: failed to update schedule for test ${testId}: ${e.message}`);
        }
      }
    }

    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    res.json({ success: true, data: series });
  } catch (err) {
    logger.error(`updateSeries error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};

export const deleteSeries = async (req, res) => {
  await service.deleteSeries(req.params.id);
  broadcastAssignedTestsChanged(req.user).catch((err) =>
    logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
  );
  res.json({ success: true });
};

export const getSeries = async (req, res) => {
  const series = await service.getSeriesById(req.params.id);
  res.json({ success: true, data: series });
};

export const getSeriesList = async (req, res, next) => {
  try {
    const series = req.query.leaderboard === "true"
      ? await service.getLeaderboardSeriesList({
        userId: req.user?._id || req.user?.id,
        userRole: req.user?.role,
      })
      : await service.getSeriesList({
        userId: req.user?._id || req.user?.id,
        search: req.query.search || "",
      });

    return res.json({
      success: true,
      data: series,
    });
  } catch (err) {
    logger.error(`getSeriesList error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const createSeriesTest = async (req, res, next) => {
  try {
    const seriesId = req.params.id;
    const data = req.body;

    // basic validation
    if (!seriesId) {
      return res.status(400).json({ success: false, message: 'Series id is required' });
    }

    const TestSeriesService = await import('./testSeries.service.js');
    const test = await TestSeriesService.createSeriesTest(seriesId, data, req.user);

    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    return res.status(201).json({ success: true, data: test });
  } catch (err) {
    logger.error(`createSeriesTest error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};
