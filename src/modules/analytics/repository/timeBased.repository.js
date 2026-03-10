import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";
import { DATE_FORMAT } from "../constants/timeBased.constants.js";

export const getTrendAnalyticsRepo = async ({ from, to, testId, organizationId, limit }) => {
  const matchStage = {};

  if (from || to) {
    matchStage.createdAt = {};
    if (from) matchStage.createdAt.$gte = from;
    if (to) matchStage.createdAt.$lte = to;
  }

  if (testId) matchStage.testId = new mongoose.Types.ObjectId(testId);
  if (organizationId) matchStage.organizationId = new mongoose.Types.ObjectId(organizationId);

  return TestAttempt.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          monthYear: { $dateToString: { format: DATE_FORMAT.MONTH_YEAR, date: "$createdAt" } },
        },
        totalAttempts: { $sum: 1 },
        avgScore: { $avg: "$percentage" },
      },
    },
    { $sort: { "_id.monthYear": 1 } },
    { $limit: limit },
    {
      $project: {
        monthYear: "$_id.monthYear",
        totalAttempts: 1,
        avgScore: { $round: ["$avgScore", 2] },
      },
    },
  ]);
};
