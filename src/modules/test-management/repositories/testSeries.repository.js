import TestSeries from "../../../models/testSeries.model.js";

const creatorRoleFilter = ["IQPATH_ADMIN", "ORGANIZATION"];

const creatorNameExpression = {
  $trim: {
    input: {
      $concat: [
        { $ifNull: ["$creatorUser.firstName", ""] },
        " ",
        { $ifNull: ["$creatorUser.lastName", ""] },
      ],
    },
  },
};

const seriesTestSelect =
  "title totalQuestions duration visibility createdAt startTime endTime isPublished scheduleType status";

export const createSeriesRepo = (data) => TestSeries.create(data);

export const findSeriesByTitleRepo = (title) =>
  TestSeries.findOne({
    title: { $regex: `^${title.trim()}$`, $options: "i" },
  });

export const updateSeriesByIdRepo = (id, data) =>
  TestSeries.findByIdAndUpdate(id, data, { new: true });

export const deleteSeriesByIdRepo = (id) => TestSeries.findByIdAndDelete(id);

export const getSeriesByIdRepo = (id) =>
  TestSeries.findById(id).populate({ path: "tests", select: seriesTestSelect });

export const getSeriesListRepo = ({ userId, search = "" } = {}) => {
  const filters = userId ? { "createdBy.userId": userId } : {};

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return TestSeries.find(filters)
    .populate({ path: "tests", select: seriesTestSelect })
    .sort({ createdAt: -1 });
};

export const aggregateLeaderboardSeriesRepo = () =>
  TestSeries.aggregate([
    {
      $match: {
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
        creatorName: creatorNameExpression,
        creatorEmail: "$creatorUser.email",
        creatorOrganizationName: "$creatorOrganization.name",
        testsCount: { $size: { $ifNull: ["$tests", []] } },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

export const addTestToSeriesRepo = (seriesId, testId) =>
  TestSeries.findByIdAndUpdate(seriesId, { $addToSet: { tests: testId } });
