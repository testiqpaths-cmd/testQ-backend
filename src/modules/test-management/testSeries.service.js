import mongoose from "mongoose";
import crypto from "crypto";
import TestSeries from "../../models/testSeries.model.js";
import TestAssignment from "../../models/testAssignment.model.js";
import logger from "../../config/logger.js";
import { computeTestStatus } from "./utils/status.js";

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

const toIdArray = (...values) =>
  values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    })
    .map((value) => String(value))
    .filter(Boolean);

const normalizeSeriesTestPayload = (data) => {
  const subjectIds = toIdArray(data.subjectIds, data.subjectId);
  const topicIds = toIdArray(data.topicIds, data.topicId);

  if (data.questionSource !== "EXCEL" && !subjectIds.length) {
    throw new Error("At least one subject is required");
  }

  return {
    ...data,
    subjectId: subjectIds[0] || data.subjectId,
    subjectIds,
    topicIds,
  };
};


export const createSeries = async (data, user) => {
  logger.debug(`Creating series for user: ${JSON.stringify(user)}`);

  console.log("Checking duplicate title:", data.title);

  const existingSeries = await TestSeries.findOne({
    title: {
      $regex: `^${data.title.trim()}$`,
      $options: "i",
    },
  });

  console.log("Existing Series:", existingSeries);

  if (existingSeries) {
    throw new Error("Test series with this title already exists");
  }
  const seriesCode =
    data.visibility === "LINK_ONLY"
      ? crypto.randomBytes(4).toString("hex")
      : undefined;

  return TestSeries.create({
    ...data,
    seriesCode,
    createdBy: {
      userId: new mongoose.Types.ObjectId(user._id || user.id),
      role: user.role,
    },
  });
};

export const updateSeries = (id, data) =>
  TestSeries.findByIdAndUpdate(id, data, { new: true });

export const deleteSeries = (id) =>
  TestSeries.findByIdAndDelete(id);

export const getSeriesById = (id) =>
  TestSeries.findById(id).populate({
    path: "tests",
    select: "title totalQuestions duration visibility createdAt startTime endTime isPublished scheduleType status",
  });

export const getSeriesList = async ({ userId, search = "" } = {}) => {
  const filters = userId ? { "createdBy.userId": userId } : {};

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return TestSeries.find(filters)
    .populate({
      path: "tests",
      select: "title totalQuestions duration visibility createdAt startTime endTime isPublished scheduleType status",
    })
    .sort({ createdAt: -1 });
};

export const getLeaderboardSeriesList = async ({ userId = null, userRole = null } = {}) => {
  const series = await TestSeries.aggregate([
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

  // Same reasoning as getLeaderboardTests: a student should only see a series'
  // leaderboard if they accepted at least one test within it — otherwise every
  // published admin/org series shows up regardless of assignment/acceptance.
  if (userRole === "STUDENT" && userId) {
    const seriesTestIds = series.flatMap((s) =>
      Array.isArray(s.tests) ? s.tests.map(String) : []
    );
    if (!seriesTestIds.length) return [];

    const assignments = await TestAssignment.find({
      studentId: userId,
      testId: { $in: seriesTestIds },
    })
      .select("testId acceptedAt status")
      .lean();

    const acceptedTestIds = new Set(
      assignments
        .filter((a) => a.acceptedAt && a.status !== "DECLINED")
        .map((a) => String(a.testId))
    );

    return series.filter(
      (s) => Array.isArray(s.tests) && s.tests.some((t) => acceptedTestIds.has(String(t)))
    );
  }

  return series;
};

// Create a new test that belongs to a series. The test will be marked as a series test
// and linked to the series' tests array.
export const createSeriesTest = async (seriesId, data, user) => {
  const mongoose = (await import('mongoose')).default;
  const Test = (await import('../../models/test.model.js')).default;

  const payload = {
    ...normalizeSeriesTestPayload(data),
    testSeriesId: seriesId,
    isSeriesTest: true,
    maxAttempts: Number(data.maxAttempts) || 1,
    testCode: data.visibility === 'LINK_ONLY' ? crypto.randomBytes(4).toString('hex') : null,
    createdBy: { userId: user._id || user.id, role: user.role },
  };

  const test = await Test.create(payload);

  // add to series tests array
  await TestSeries.findByIdAndUpdate(seriesId, { $addToSet: { tests: test._id } });

  // Compute and persist status for the created series test
  test.status = computeTestStatus(test);
  await test.save();

  return test;
};
