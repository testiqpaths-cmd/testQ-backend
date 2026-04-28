import mongoose from "mongoose";
import crypto from "crypto";
import TestSeries from "../../models/testSeries.model.js";
import logger from "../../config/logger.js";


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
  TestSeries.findById(id).populate("tests");

export const getSeriesList = async ({ userId, search = "" } = {}) => {
  const filters = userId ? { "createdBy.userId": userId } : {};

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return TestSeries.find(filters)
    .populate({ path: "tests", select: "title totalQuestions duration visibility createdAt" })
    .sort({ createdAt: -1 });
};
