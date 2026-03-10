import mongoose from "mongoose";
import TestAttempt from "../../../../models/testAttempt.model.js";

export const getTestWiseStats = async (testId) => {
  const stats = await TestAttempt.aggregate([
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

  // Handle empty results gracefully
  return stats[0] || {
    totalAttempts: 0,
    averageScore: null,
    highestScore: null,
    lowestScore: null,
    passCount: 0,
    failCount: 0,
  };
};
