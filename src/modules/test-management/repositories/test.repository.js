import Test from "../../../models/test.model.js";
import User from "../../auth/models/User.model.js";

const creatorRoleFilter = ["IQPATH_ADMIN", "ORGANIZATION"];

const leaderboardCreatorFields = [
  { $ifNull: ["$creatorUser.firstName", ""] },
  " ",
  { $ifNull: ["$creatorUser.lastName", ""] },
];

export const createTestRepo = (payload) => Test.create(payload);

export const saveTestRepo = (testDoc) => testDoc.save();

export const getTestByIdLeanRepo = (id) => Test.findById(id).lean();

export const findTestByIdRepo = (id) => Test.findById(id);

export const getTestSummaryForAttemptRepo = (testId) =>
  Test.findById(testId).select("title duration createdBy isIQRoomTest").lean();

export const getTestTitleAndEvalTypeRepo = (testId) =>
  Test.findById(testId).select("title evaluationType").lean();

export const getTestTitleRepo = (testId) => Test.findById(testId).select("title");

export const getExpiredPublishedTestsRepo = (now) =>
  Test.find({
    isPublished: true,
    isDeleted: { $ne: 1 },
    isIQRoomTest: { $ne: true },
    endTime: { $lt: now },
  });

export const findAllStandaloneTestsRepo = () =>
  Test.find({ isSeriesTest: { $ne: true }, isIQRoomTest: { $ne: true } }).sort({
    createdAt: -1,
  });

export const aggregateLeaderboardTestsRepo = () =>
  Test.aggregate([
    {
      $match: {
        isSeriesTest: { $ne: true },
        isIQRoomTest: { $ne: true },
        "createdBy.role": { $in: creatorRoleFilter },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy.userId",
        foreignField: "_id",
        as: "creatorUser",
      },
    },
    {
      $unwind: {
        path: "$creatorUser",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "organizations",
        localField: "creatorUser.organizationId",
        foreignField: "_id",
        as: "creatorOrganization",
      },
    },
    {
      $unwind: {
        path: "$creatorOrganization",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        creatorName: {
          $trim: {
            input: { $concat: leaderboardCreatorFields },
          },
        },
        creatorEmail: "$creatorUser.email",
        creatorOrganizationName: "$creatorOrganization.name",
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

export const getMyTestsRepo = ({ userId, search = "" }) => {
  const filters = {
    "createdBy.userId": userId,
    isDeleted: { $ne: 1 },
    isSeriesTest: { $ne: true },
    isIQRoomTest: { $ne: true },
  };

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return Test.find(filters)
    .populate("subjectId", "name")
    .sort({ createdAt: -1 });
};

export const getAssignedTestsRepo = ({ search = "", userCreatedAt = null } = {}) => {
  const filters = {
    isPublished: true,
    isDeleted: { $ne: 1 },
    isIQRoomTest: { $ne: true },
  };

  if (userCreatedAt) {
    filters.createdAt = { $gte: new Date(userCreatedAt) };
  }

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return Test.find(filters)
    .populate("subjectId", "name")
    .populate({
      path: "testSeriesId",
      select: "title description visibility createdAt",
    })
    .sort({ createdAt: -1 });
};

export const getUserCreatedAtByIdRepo = (userId) =>
  User.findById(userId).select("createdAt");
