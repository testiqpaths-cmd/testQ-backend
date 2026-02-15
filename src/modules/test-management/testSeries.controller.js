import * as service from "./testSeries.service.js";
import logger from "../../config/logger.js";
import mongoose from "mongoose";
import TestSeries from "../../models/testSeries.model.js";

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

    const allowedRoles = ["IQPATH_ADMIN", "ORGANIZATION","STUDENT"];
    const series = await TestSeries.create({
      title: title.trim(),
      description: description?.trim() || "",
      visibility,
      tests: cleanedTests,
      createdBy: {
        userId: req.user?._id,
        role: allowedRoles.includes(req.user?.role) ? req.user.role : "ORGANIZATION", // default to a valid role
      },
    });

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
  const series = await service.updateSeries(req.params.id, req.body);
  res.json({ success: true, data: series });
};

export const deleteSeries = async (req, res) => {
  await service.deleteSeries(req.params.id);
  res.json({ success: true });
};

export const getSeries = async (req, res) => {
  const series = await service.getSeriesById(req.params.id);
  res.json({ success: true, data: series });
};
