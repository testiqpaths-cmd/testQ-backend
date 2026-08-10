import mongoose from "mongoose";
import crypto from "crypto";
import TestSeries from "../../models/testSeries.model.js";
import TestAssignment from "../../models/testAssignment.model.js";
import logger from "../../config/logger.js";
import { computeTestStatus } from "./utils/status.js";
import { ensureCreatorOrgIncluded, resolveAllowedStudents } from "./utils/visibility.js";

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

  const payload = {
    ...data,
    seriesCode,
    allowedStudents: await resolveAllowedStudents(data.visibility, data.allowedStudents, user),
    createdBy: {
      userId: new mongoose.Types.ObjectId(user._id || user.id),
      role: user.role,
    },
  };
  await ensureCreatorOrgIncluded(payload);

  return TestSeries.create(payload);
};

export const updateSeries = async (id, data) => {
  const series = await TestSeries.findById(id);
  if (!series) return null;

  Object.assign(series, data);
  await ensureCreatorOrgIncluded(series);
  await series.save();

  return series;
};

export const deleteSeries = (id) =>
  TestSeries.findByIdAndDelete(id);

export const getSeriesById = (id) =>
  TestSeries.findById(id).populate({
    path: "tests",
    select: "title totalQuestions duration visibility createdAt startTime endTime isPublished scheduleType status",
  });

// Per-series stats for the creator (org/admin): who's registered (accepted
// the series), who's completed every test in it, who hasn't, and each
// registered student's per-test results — same shape as test.service.js's
// getTestStats, one level up.
export const getSeriesStats = async (seriesId) => {
  const TestSeriesAssignment = (await import("../../models/testSeriesAssignment.model.js")).default;
  const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
  const TestAttempt = (await import("../../models/testAttempt.model.js")).default;
  const User = (await import("../auth/models/User.model.js")).default;
  const Test = (await import("../../models/test.model.js")).default;

  const series = await TestSeries.findById(seriesId).select("tests").lean();
  const testIds = series?.tests || [];

  const tests = testIds.length
    ? await Test.find({ _id: { $in: testIds } }).select("title").lean()
    : [];
  const testTitleMap = new Map(tests.map((t) => [String(t._id), t.title]));

  const seriesAssignments = await TestSeriesAssignment.find({ seriesId }).lean();

  const studentIds = seriesAssignments.map((a) => a.studentId);
  const students = studentIds.length
    ? await User.find({ _id: { $in: studentIds } }).select("firstName lastName email").lean()
    : [];
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  // Every per-test assignment for every student, across every test in the
  // series — this is what "completed the series" is actually derived from
  // (TestSeriesAssignment itself only tracks PENDING/ACCEPTED/DECLINED/
  // HIDDEN, not per-test progress).
  const testAssignments = testIds.length
    ? await TestAssignment.find({ testId: { $in: testIds } }).lean()
    : [];
  const assignmentsByStudent = new Map();
  for (const a of testAssignments) {
    const key = String(a.studentId);
    if (!assignmentsByStudent.has(key)) assignmentsByStudent.set(key, new Map());
    assignmentsByStudent.get(key).set(String(a.testId), a);
  }

  // Latest submitted/evaluated attempt per (student, test) pair.
  const attempts = testIds.length
    ? await TestAttempt.find({ testId: { $in: testIds }, status: { $in: ["SUBMITTED", "EVALUATED"] } })
        .select("studentId testId totalScore maxScore percentage resultStatus submittedAt")
        .sort({ submittedAt: -1 })
        .lean()
    : [];
  const attemptKey = (studentId, testId) => `${studentId}:${testId}`;
  const latestAttemptByPair = new Map();
  for (const attempt of attempts) {
    const key = attemptKey(String(attempt.studentId), String(attempt.testId));
    if (!latestAttemptByPair.has(key)) latestAttemptByPair.set(key, attempt);
  }

  const byStatus = { PENDING: 0, ACCEPTED: 0, DECLINED: 0, HIDDEN: 0 };

  const studentRows = seriesAssignments.map((assignment) => {
    const studentId = String(assignment.studentId);
    const student = studentMap.get(studentId);
    if (byStatus[assignment.status] !== undefined) byStatus[assignment.status] += 1;

    const perTestAssignments = assignmentsByStudent.get(studentId) || new Map();
    const testResults = testIds.map((testId) => {
      const tId = String(testId);
      const testAssignment = perTestAssignments.get(tId);
      const attempt = latestAttemptByPair.get(attemptKey(studentId, tId));

      return {
        testId: tId,
        testTitle: testTitleMap.get(tId) || "Untitled Test",
        status: testAssignment ? testAssignment.status : "PENDING",
        result: attempt
          ? {
              attemptId: attempt._id,
              totalScore: attempt.totalScore,
              maxScore: attempt.maxScore,
              percentage: attempt.percentage,
              resultStatus: attempt.resultStatus,
            }
          : null,
      };
    });

    const testsTotal = testIds.length;
    const testsCompleted = testResults.filter((t) => t.status === "SUBMITTED").length;

    const scoreTotals = testResults.reduce(
      (acc, t) => {
        if (t.result) {
          acc.totalScore += t.result.totalScore || 0;
          acc.maxScore += t.result.maxScore || 0;
          acc.hasAny = true;
        }
        return acc;
      },
      { totalScore: 0, maxScore: 0, hasAny: false }
    );

    return {
      studentId,
      name: student ? `${student.firstName || ""} ${student.lastName || ""}`.trim() || "Unknown" : "Unknown",
      email: student?.email || null,
      assignmentStatus: assignment.status,
      testsCompleted,
      testsTotal,
      overallScore: scoreTotals.hasAny
        ? {
            totalScore: scoreTotals.totalScore,
            maxScore: scoreTotals.maxScore,
            percentage: scoreTotals.maxScore > 0 ? (scoreTotals.totalScore / scoreTotals.maxScore) * 100 : 0,
          }
        : null,
      testResults,
    };
  });

  const registered = seriesAssignments.filter((a) => a.status === "ACCEPTED").length;
  // Only counts as "completed" once every test in the series has been
  // submitted — a series with zero tests never counts anyone as completed.
  const completed = studentRows.filter(
    (s) => s.assignmentStatus === "ACCEPTED" && s.testsTotal > 0 && s.testsCompleted === s.testsTotal
  ).length;

  return {
    summary: {
      totalAssigned: seriesAssignments.length,
      registered,
      completed,
      notCompleted: registered - completed,
      totalTests: testIds.length,
      byStatus,
    },
    students: studentRows,
  };
};

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

export const getLeaderboardSeriesList = async ({ userId = null, userRole = null, userOrganizationId = null } = {}) => {
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

  // Same reasoning as getLeaderboardTests: an organization should only see
  // its own series' leaderboards, plus any admin-created series that
  // specifically targeted this org — not every other org's series, and not
  // an admin's PUBLIC series just because it's technically open.
  if (userRole === "ORGANIZATION") {
    const orgId = userOrganizationId ? String(userOrganizationId) : null;
    if (!orgId) return [];

    return series.filter((s) => {
      const creatorOrgId = s.creatorUser?.organizationId ? String(s.creatorUser.organizationId) : null;
      const isOwnSeries = creatorOrgId === orgId;
      const isAdminSeriesTargetingUs =
        s.createdBy?.role === "IQPATH_ADMIN" &&
        s.visibility === "ORG_ONLY" &&
        Array.isArray(s.allowedOrganizations) &&
        s.allowedOrganizations.some((id) => String(id) === orgId);

      return isOwnSeries || isAdminSeriesTargetingUs;
    });
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
    allowedStudents: await resolveAllowedStudents(data.visibility, data.allowedStudents, user),
    createdBy: { userId: user._id || user.id, role: user.role },
  };
  await ensureCreatorOrgIncluded(payload);

  const test = await Test.create(payload);

  // add to series tests array
  await TestSeries.findByIdAndUpdate(seriesId, { $addToSet: { tests: test._id } });

  // Compute and persist status for the created series test
  test.status = computeTestStatus(test);
  await test.save();

  // A student who already accepted this series shouldn't have to separately
  // accept a test added to it afterward — auto-accept the new test for
  // everyone who's already accepted the series as a whole.
  const TestSeriesAssignment = (await import('../../models/testSeriesAssignment.model.js')).default;
  const acceptedStudentIds = await TestSeriesAssignment.find({ seriesId, status: "ACCEPTED" })
    .distinct("studentId");
  if (acceptedStudentIds.length) {
    await TestAssignment.bulkWrite(
      acceptedStudentIds.map((studentId) => ({
        updateOne: {
          filter: { testId: test._id, studentId },
          update: { $set: { status: "ACCEPTED", acceptedAt: new Date() } },
          upsert: true,
        },
      }))
    );
  }

  return test;
};
