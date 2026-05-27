import mongoose from "mongoose";
import TestAttempt from "../../models/testAttempt.model.js";
import TestSeries from "../../models/testSeries.model.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

const buildStudentName = {
  $trim: {
    input: {
      $concat: [
        { $ifNull: ["$student.firstName", ""] },
        " ",
        { $ifNull: ["$student.lastName", ""] },
      ],
    },
  },
};

const normalizePageAndLimit = (query) => {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.max(1, Number(query.limit || 10));

  return { page, limit, skip: (page - 1) * limit };
};

// 🧪 TEST leaderboard
export const getTestLeaderboard = async (testId, query) => {
  if (!mongoose.Types.ObjectId.isValid(testId)) {
    throw new ApiError(400, "Invalid testId");
  }

  const { page, limit, skip } = normalizePageAndLimit(query);
  const matchStage = {
    testId: new mongoose.Types.ObjectId(testId),
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  };

  const totalPromise = TestAttempt.countDocuments(matchStage);

  // ✅ get sorted results
  const itemsPromise = TestAttempt.aggregate([
    { $match: matchStage },

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

        studentName: buildStudentName,
        email: "$student.email",
      },
    },

    { $skip: skip },

    { $limit: limit },
  ]);

  const [results, total] = await Promise.all([itemsPromise, totalPromise]);

  // ✅ manual rank generation
  const leaderboard = results.map((item, index) => ({
    ...item,
    rank: skip + index + 1,
  }));

  return {
    items: leaderboard,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

// 📚 SERIES leaderboard
export const getSeriesLeaderboard = async (seriesId, query) => {
  if (!mongoose.Types.ObjectId.isValid(seriesId)) {
    throw new ApiError(400, "Invalid seriesId");
  }

  const { page, limit, skip } = normalizePageAndLimit(query);

  const series = await TestSeries.findById(seriesId).select("tests");
  if (!series) {
    return {
      items: [] ,
      pagination: { page, limit, total: 0, totalPages: 1 },
    };
  }

  const testIds = series.tests;

  const matchStage = {
    testId: {
      $in: testIds.map((id) => new mongoose.Types.ObjectId(id)),
    },
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  };

  const totalPromise = TestAttempt.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$studentId",
      },
    },
    { $count: "total" },
  ]).then((result) => result[0]?.total || 0);

  const itemsPromise = TestAttempt.aggregate([
    { $match: matchStage },

    // 🧠 IMPORTANT: group per student
    {
      $group: {
        _id: "$studentId",

        totalScore: { $sum: "$totalScore" },
        totalTime: { $sum: "$timeTakenSeconds" },
        avgAccuracy: { $avg: "$accuracy" },
        attempts: { $sum: 1 },
      },
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
        totalScore: 1,
        totalTime: 1,
        avgAccuracy: 1,
        attempts: 1,

        studentName: buildStudentName,
        email: "$student.email",
      },
    },

    { $skip: skip },
    { $limit: limit },
  ]);

  const [items, total] = await Promise.all([itemsPromise, totalPromise]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};
