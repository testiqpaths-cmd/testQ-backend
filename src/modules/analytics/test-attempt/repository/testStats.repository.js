import mongoose from "mongoose";
import TestAttempt from "../../../../models/testAttempt.model.js";

export const getTestWiseStats = async (testId) => {
  return TestAttempt.aggregate([
    {
      $match: {
        testId: new mongoose.Types.ObjectId(testId),
      },
    },
    {
      $group: {
        _id: "$testId",
        totalAttempts: { $sum: 1 },
        averageScore: { $avg: "$totalScore" },
        highestScore: { $max: "$totalScore" },
        lowestScore: { $min: "$totalScore" },
        passCount: {
          $sum: {
            $cond: [{ $eq: ["$resultStatus", "PASS"] }, 1, 0],
          },
        },
        failCount: {
          $sum: {
            $cond: [{ $eq: ["$resultStatus", "FAIL"] }, 1, 0],
          },
        },
      },
    },
  ]);
};
