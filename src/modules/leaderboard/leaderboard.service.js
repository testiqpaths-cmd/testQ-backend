import mongoose from "mongoose";
import TestAttempt from "../../models/testAttempt.model.js";
import TestSeries from "../../models/testSeries.model.js";

// 🧪 TEST leaderboard
export const getTestLeaderboard = async (testId, query) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 10);

  const skip = (page - 1) * limit;

  // ✅ get sorted results
  const results = await TestAttempt.aggregate([
    {
      $match: {
        testId: new mongoose.Types.ObjectId(testId),
        status: { $in: ["SUBMITTED", "EVALUATED"] },
      },
    },

    {
      $lookup: {
        from: "users",
        localField: "studentId",
        foreignField: "_id",
        as: "student",
      },
    },

    {
      $unwind: "$student",
    },

    // ✅ sorting logic
    {
      $sort: {
        totalScore: -1,
        accuracy: -1,
        timeTakenSeconds: 1,
      },
    },

    {
      $project: {
        totalScore: 1,
        percentage: 1,
        accuracy: 1,
        timeTakenSeconds: 1,
        correctAnswersCount: 1,
        incorrectAnswersCount: 1,
        unattemptedCount: 1,

        studentName: "$student.fullName",
        email: "$student.email",
      },
    },

    { $skip: skip },

    { $limit: limit },
  ]);

  // ✅ manual rank generation
  const leaderboard = results.map((item, index) => ({
    rank: skip + index + 1,

    username: item.studentName,
   institute: item.institute || "Medicaps University",

    correctQuestions: item.correctAnswersCount,
    incorrectQuestions: item.incorrectAnswersCount,
    totalQuestions:
      (item.correctAnswersCount || 0) +
      (item.incorrectAnswersCount || 0) +
      (item.unattemptedCount || 0),

    score: item.totalScore,
    timeTaken: item.timeTakenSeconds,
  }));

  return leaderboard;
};

// 📚 SERIES leaderboard
export const getSeriesLeaderboard = async (seriesId, query) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 10);
  const skip = (page - 1) * limit;

  const series = await TestSeries.findById(seriesId).select("tests");
  if (!series) return [];

  const testIds = series.tests;

  return await TestAttempt.aggregate([
    {
      $match: {
        testId: {
          $in: testIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
        status: { $in: ["SUBMITTED", "EVALUATED"] },
      },
    },

    // 🧠 IMPORTANT: group per student
    {
  $group: {
    _id: "$studentId",

    totalScore: { $sum: "$totalScore" },
    totalTime: { $sum: "$timeTakenSeconds" },

    correctQuestions: { $sum: "$correctAnswersCount" },
    incorrectQuestions: { $sum: "$incorrectAnswersCount" },
    unattemptedQuestions: { $sum: "$unattemptedCount" },

    attempts: { $sum: 1 }
  }
},
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "student",
      },
    },
    { $unwind: "$student" },

    {
      $sort: {
        totalScore: -1,
        totalTime: 1,
      },
    },

    {
      $setWindowFields: {
        sortBy: {
          totalScore: -1,
          totalTime: 1,
        },
        output: {
          rank: { $rank: {} },
        },
      },
    },

   {
  $project: {
    rank: 1,

    username: "$student.fullName",
    institute: "$student.institute",

    correctQuestions: 1,
    incorrectQuestions: 1,
    unattemptedQuestions: 1,

    totalQuestions: {
      $add: [
        "$correctQuestions",
        "$incorrectQuestions",
        "$unattemptedQuestions"
      ]
    },

    score: "$totalScore",
    timeTaken: "$totalTime"
  }
},
    { $skip: skip },
    { $limit: limit },
  ]);
};
