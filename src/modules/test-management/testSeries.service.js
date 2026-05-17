import mongoose from "mongoose";
import crypto from "crypto";
import TestSeries from "../../models/testSeries.model.js";
import logger from "../../config/logger.js";
import { computeTestStatus } from "./utils/status.js";


export const createSeries = async (data, user) => {
  logger.debug(`Creating series for user: ${JSON.stringify(user)}`);
  const seriesCode =
    data.visibility === "LINK_ONLY"
      ? crypto.randomBytes(4).toString("hex")
      : undefined;

  return TestSeries.create({
    ...data,
    seriesCode,
    createdBy: {
      userId: new mongoose.Types.ObjectId(user._id || user.id),
      role: user.role,
    },
  });
};

export const updateSeries = (id, data) =>
  TestSeries.findByIdAndUpdate(id, data, { new: true });

export const deleteSeries = (id) =>
  TestSeries.findByIdAndDelete(id);

export const getSeriesById = (id) =>
  TestSeries.findById(id).populate({
    path: "tests",
    select: "title totalQuestions duration visibility createdAt startTime endTime isPublished scheduleType status",
  });

export const getSeriesList = async ({ userId, search = "" } = {}) => {
  const filters = userId ? { "createdBy.userId": userId } : {};

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return TestSeries.find(filters)
    .populate({
      path: "tests",
      select: "title totalQuestions duration visibility createdAt startTime endTime isPublished scheduleType status",
    })
    .sort({ createdAt: -1 });
};

// Create a new test that belongs to a series. The test will be marked as a series test
// and linked to the series' tests array.
export const createSeriesTest = async (seriesId, data, user) => {
  const mongoose = (await import('mongoose')).default;
  const Test = (await import('../../models/test.model.js')).default;

  const payload = {
    ...data,
    testSeriesId: seriesId,
    isSeriesTest: true,
    maxAttempts: Number(data.maxAttempts) || 1,
    testCode: data.visibility === 'LINK_ONLY' ? crypto.randomBytes(4).toString('hex') : null,
    createdBy: { userId: user._id || user.id, role: user.role },
  };

  const test = await Test.create(payload);

  // add to series tests array
  await TestSeries.findByIdAndUpdate(seriesId, { $addToSet: { tests: test._id } });

  // Compute and persist status for the created series test
  test.status = computeTestStatus(test);
  await test.save();

  return test;
};
