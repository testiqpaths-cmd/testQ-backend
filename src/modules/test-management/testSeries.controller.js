import * as service from "./testSeries.service.js";
import logger from "../../config/logger.js";
import mongoose from "mongoose";

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

    res.json({ success: true, data: series });
  } catch (err) {
    logger.error(`updateSeries error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};

export const deleteSeries = async (req, res) => {
  await service.deleteSeries(req.params.id);
  res.json({ success: true });
};

export const getSeries = async (req, res) => {
  const series = await service.getSeriesById(req.params.id);
  res.json({ success: true, data: series });
};

export const getSeriesList = async (req, res, next) => {
  try {
    const series = req.query.leaderboard === "true"
      ? await service.getLeaderboardSeriesList()
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

    const test = await service.createSeriesTest(seriesId, data, req.user);

    return res.status(201).json({ success: true, data: test });
  } catch (err) {
    logger.error(`createSeriesTest error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};
