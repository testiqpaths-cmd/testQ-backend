import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";
import TestSeries from "../../../models/testSeries.model.js";

const ATTEMPT_STATUSES = ["SUBMITTED", "EVALUATED", "MISSED"];

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

const addResolvedAttemptStatsStage = {
  $addFields: {
    totalQuestions: {
      $cond: [
        { $isArray: "$questionSnapshots" },
        { $size: "$questionSnapshots" },
        0,
      ],
    },
    correctAnswersCount: {
      $size: {
        $filter: {
          input: { $ifNull: ["$answers", []] },
          as: "answer",
          cond: { $eq: ["$$answer.isCorrect", true] },
        },
      },
    },
    incorrectAnswersCount: {
      $size: {
        $filter: {
          input: { $ifNull: ["$answers", []] },
          as: "answer",
          cond: { $eq: ["$$answer.isCorrect", false] },
        },
      },
    },
    answeredCount: {
      $size: {
        $filter: {
          input: { $ifNull: ["$answers", []] },
          as: "answer",
          cond: {
            $or: [
              { $ne: ["$$answer.selectedOption", null] },
              { $ne: ["$$answer.textAnswer", null] },
            ],
          },
        },
      },
    },
    resolvedTimeTakenSeconds: {
      $round: [
        {
          $divide: [
            {
              $sum: {
                $map: {
                  input: { $ifNull: ["$questionSnapshots", []] },
                  as: "question",
                  in: { $ifNull: ["$$question.timeSpentMs", 0] },
                },
              },
            },
            1000,
          ],
        },
        0,
      ],
    },
  },
};

const finalizeResolvedAttemptStatsStage = {
  $addFields: {
    attemptedCount: {
      $max: [
        "$answeredCount",
        { $add: ["$correctAnswersCount", "$incorrectAnswersCount"] },
      ],
    },
    unattemptedCount: {
      $max: [
        0,
        {
          $subtract: [
            "$totalQuestions",
            {
              $max: [
                "$answeredCount",
                { $add: ["$correctAnswersCount", "$incorrectAnswersCount"] },
              ],
            },
          ],
        },
      ],
    },
    accuracy: {
      $cond: [
        {
          $gt: [
            {
              $max: [
                "$answeredCount",
                { $add: ["$correctAnswersCount", "$incorrectAnswersCount"] },
              ],
            },
            0,
          ],
        },
        {
          $multiply: [
            {
              $divide: [
                "$correctAnswersCount",
                {
                  $max: [
                    "$answeredCount",
                    { $add: ["$correctAnswersCount", "$incorrectAnswersCount"] },
                  ],
                },
              ],
            },
            100,
          ],
        },
        0,
      ],
    },
    timeTakenSeconds: {
      $cond: [
        { $gt: ["$resolvedTimeTakenSeconds", 0] },
        "$resolvedTimeTakenSeconds",
        { $ifNull: ["$timeTakenSeconds", 0] },
      ],
    },
  },
};

const rankSortStage = {
  $sort: {
    totalScore: -1,
    accuracy: -1,
    timeTakenSeconds: 1,
  },
};

export const countDistinctStudentsForTestRepo = (testId) =>
  TestAttempt.distinct("studentId", {
    testId: new mongoose.Types.ObjectId(testId),
    status: { $in: ATTEMPT_STATUSES },
  }).then((ids) => ids.length);

export const getTestLeaderboardItemsRepo = (testId, { skip, limit }) =>
  TestAttempt.aggregate([
    {
      $match: {
        testId: new mongoose.Types.ObjectId(testId),
        status: { $in: ATTEMPT_STATUSES },
      },
    },

    addResolvedAttemptStatsStage,
    finalizeResolvedAttemptStatsStage,

    // Sort attempts best-first, then keep only each student's first (= best) one.
    rankSortStage,
    {
      $group: {
        _id: "$studentId",
        studentId: { $first: "$studentId" },
        totalScore: { $first: "$totalScore" },
        maxScore: { $first: "$maxScore" },
        percentage: { $first: "$percentage" },
        accuracy: { $first: "$accuracy" },
        timeTakenSeconds: { $first: "$timeTakenSeconds" },
        correctAnswersCount: { $first: "$correctAnswersCount" },
        incorrectAnswersCount: { $first: "$incorrectAnswersCount" },
        unattemptedCount: { $first: "$unattemptedCount" },
        attemptedCount: { $first: "$attemptedCount" },
        totalQuestions: { $first: "$totalQuestions" },
      },
    },

    // $group doesn't preserve order, so re-rank the one-row-per-student results.
    rankSortStage,

    { $skip: skip },

    { $limit: limit },

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

    {
      $project: {
        totalScore: 1,
        maxScore: 1,
        percentage: 1,
        accuracy: 1,
        timeTakenSeconds: 1,
        correctAnswersCount: 1,
        incorrectAnswersCount: 1,
        unattemptedCount: 1,
        attemptedCount: 1,
        totalQuestions: 1,

        studentName: buildStudentName,
        email: "$student.email",
      },
    },
  ]);

export const getSeriesByIdForLeaderboardRepo = (seriesId) =>
  TestSeries.findById(seriesId).select("tests");

export const countDistinctStudentsForSeriesRepo = (testIds) =>
  TestAttempt.aggregate([
    {
      $match: {
        testId: { $in: testIds.map((id) => new mongoose.Types.ObjectId(id)) },
        status: { $in: ATTEMPT_STATUSES },
      },
    },
    {
      $group: {
        _id: "$studentId",
      },
    },
    { $count: "total" },
  ]).then((result) => result[0]?.total || 0);

export const getSeriesLeaderboardItemsRepo = (testIds, { skip, limit }) =>
  TestAttempt.aggregate([
    {
      $match: {
        testId: { $in: testIds.map((id) => new mongoose.Types.ObjectId(id)) },
        status: { $in: ATTEMPT_STATUSES },
      },
    },

    // 🧠 IMPORTANT: group per student
    addResolvedAttemptStatsStage,
    finalizeResolvedAttemptStatsStage,

    {
      $group: {
        _id: "$studentId",

        totalScore: { $sum: "$totalScore" },
        maxScore: { $sum: "$maxScore" },
        totalTime: { $sum: "$timeTakenSeconds" },
        avgAccuracy: { $avg: "$accuracy" },
        correctAnswersCount: { $sum: "$correctAnswersCount" },
        incorrectAnswersCount: { $sum: "$incorrectAnswersCount" },
        unattemptedCount: { $sum: "$unattemptedCount" },
        attemptedCount: { $sum: "$attemptedCount" },
        totalQuestions: { $sum: "$totalQuestions" },
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
      $project: {
        totalScore: 1,
        maxScore: 1,
        totalTime: 1,
        timeTakenSeconds: "$totalTime",
        avgAccuracy: 1,
        accuracy: "$avgAccuracy",
        correctAnswersCount: 1,
        incorrectAnswersCount: 1,
        unattemptedCount: 1,
        attemptedCount: 1,
        totalQuestions: 1,
        attempts: 1,

        studentName: buildStudentName,
        email: "$student.email",
      },
    },

    { $skip: skip },
    { $limit: limit },
  ]);
