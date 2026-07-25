import mongoose from "mongoose";
import TestAttempt from "../../models/testAttempt.model.js";
import TestSeries from "../../models/testSeries.model.js";
import UserModel from "../../models/user.model.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

// An ORGANIZATION-role caller must only ever see their own students on a
// leaderboard — without this, any org account could read another org's
// students' names/emails/scores for a shared/public test by just hitting
// this endpoint with that test's id. STUDENT/IQPATH_ADMIN callers are
// unaffected (a leaderboard is expected to show every participant to the
// students taking the same test, and admins need full visibility).
const restrictMatchToRequesterOrgStudents = async (matchStage, requester) => {
  if (!requester || requester.role !== "ORGANIZATION") return matchStage;

  let orgId = requester.organizationId || null;
  if (!orgId) {
    const dbUser = await UserModel.findById(requester._id).select("organizationId").lean();
    orgId = dbUser?.organizationId ?? null;
  }
  if (!orgId) return { ...matchStage, studentId: { $in: [] } };

  const orgStudentIds = await UserModel.find({ role: "STUDENT", organizationId: orgId, isDeleted: false })
    .distinct("_id");

  return { ...matchStage, studentId: { $in: orgStudentIds } };
};

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

// 🧪 TEST leaderboard
export const getTestLeaderboard = async (testId, query, requester) => {
  if (!mongoose.Types.ObjectId.isValid(testId)) {
    throw new ApiError(400, "Invalid testId");
  }

  const { page, limit, skip } = normalizePageAndLimit(query);
  let matchStage = {
    testId: new mongoose.Types.ObjectId(testId),
    status: { $in: ["SUBMITTED", "EVALUATED", "MISSED"] },
  };
  matchStage = await restrictMatchToRequesterOrgStudents(matchStage, requester);

  // Rank by distinct students, not attempts — a student with multiple attempts
  // should occupy one leaderboard row (their best attempt), not one row each.
  const totalPromise = TestAttempt.distinct("studentId", matchStage).then(
    (ids) => ids.length
  );

  const rankSortStage = {
    $sort: {
      totalScore: -1,
      accuracy: -1,
      timeTakenSeconds: 1,
    },
  };

  // ✅ get sorted results
  const itemsPromise = TestAttempt.aggregate([
    { $match: matchStage },

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
export const getSeriesLeaderboard = async (seriesId, query, requester) => {
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

  let matchStage = {
    testId: {
      $in: testIds.map((id) => new mongoose.Types.ObjectId(id)),
    },
    status: { $in: ["SUBMITTED", "EVALUATED", "MISSED"] },
  };
  matchStage = await restrictMatchToRequesterOrgStudents(matchStage, requester);

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

  const [results, total] = await Promise.all([itemsPromise, totalPromise]);

  const items = results.map((item, index) => ({
    ...item,
    rank: skip + index + 1,
  }));

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
