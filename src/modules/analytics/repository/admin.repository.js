import User from "../../../models/user.model.js";
import Test from "../../../models/test.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";

// Count total students
export const countStudents = async () => {
  try {
    return await User.countDocuments({ role: "STUDENT" }).lean();
  } catch (error) {
    console.error("Error counting students:", error);
    return 0;
  }
};

// Count total tests
export const countTests = async () => {
  try {
    return await Test.countDocuments().lean();
  } catch (error) {
    console.error("Error counting tests:", error);
    return 0;
  }
};

// Count total attempts
export const countAttempts = async () => {
  try {
    return await TestAttempt.countDocuments().lean();
  } catch (error) {
    console.error("Error counting attempts:", error);
    return 0;
  }
};

// Average score across platform
export const getAverageScore = async () => {
  try {
    const result = await TestAttempt.aggregate([
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$percentage" },
        },
      },
    ]);
    return result[0]?.averageScore || 0;
  } catch (error) {
    console.error("Error calculating average score:", error);
    return 0;
  }
};

// Top performing tests
export const getTopPerformingTests = async () => {
  try {
    const result = await TestAttempt.aggregate([
      {
        $group: {
          _id: "$testId",
          avgScore: { $avg: "$percentage" },
          attemptCount: { $sum: 1 },
        },
      },
      { $sort: { avgScore: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "tests",
          localField: "_id",
          foreignField: "_id",
          as: "test",
        },
      },
      { $unwind: "$test" },
      {
        $project: {
          testId: "$_id",
          testName: "$test.name",
          avgScore: 1,
          attemptCount: 1,
        },
      },
    ]);
    return result;
  } catch (error) {
    console.error("Error fetching top performing tests:", error);
    return [];
  }
};
