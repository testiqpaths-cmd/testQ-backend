import crypto from "crypto";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";
import TestAssignment from "../../models/testAssignment.model.js";
import { computeTestStatus } from "./utils/status.js";
import { dispatchNotificationToStudents } from "../notification/notification.service.js";

const creatorRoleFilter = ["IQPATH_ADMIN", "ORGANIZATION"];

const leaderboardCreatorFields = [
  { $ifNull: ["$creatorUser.firstName", ""] },
  " ",
  { $ifNull: ["$creatorUser.lastName", ""] },
];

const toIdArray = (...values) =>
  values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    })
    .map((value) => String(value))
    .filter(Boolean);

const normalizeTestPayload = (data) => {
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

export async function createTest(data, user) {
  // Prevent creating series tests via the normal test creation flow.
  if (data.testSeriesId) {
    throw new Error("Series tests must be created via the Test Series flow");
  }

  const payload = {
    ...normalizeTestPayload(data),
    maxAttempts: Number(data.maxAttempts) || 1,
    testCode:
      data.visibility === "LINK_ONLY"
        ? crypto.randomBytes(4).toString("hex")
        : null,
    createdBy: { userId: user._id || user.id, role: user.role },
  };

  const test = await Test.create(payload);

  // Students create tests only for themselves to practice on — there's no
  // review/schedule workflow for them, so their tests go live immediately
  // instead of sitting in an un-startable DRAFT state.
  if (user.role === "STUDENT") {
    test.isPublished = true;
    test.publishedAt = new Date();
    test.status = computeTestStatus(test);
  } else {
    test.status = "DRAFT";
    test.isPublished = false;
  }
  await test.save();

  return test;
}

export async function updateTest(test, payload, user) {
  Object.assign(test, payload);

  const hasFixedSchedule = Boolean(test.startTime && test.endTime);
  if (hasFixedSchedule) {
    test.scheduleType = "FIXED";
  }

  // Always derive status fresh from isPublished + schedule. computeTestStatus
  // already returns "DRAFT" whenever isPublished is false, so a draft test
  // edited without an explicit isPublished:true stays DRAFT; an explicit
  // publish (isPublished: true) or a reschedule of an already-published test
  // both get the correct UPCOMING/ACTIVE/COMPLETED status. The previous
  // prevStatus-based guard here reverted isPublished/status back to DRAFT
  // whenever the payload didn't also include a literal status: "PUBLISHED"
  // field, silently undoing publish attempts that only sent isPublished: true.
  test.status = computeTestStatus(test);

  await test.save();

  return test;
}

export async function deleteTest(test) {
  test.isDeleted = 1;
  await test.save();
}

export const getAllTests = async () => {
  // Exclude tests that belong to a series or IQ Room
  return await Test.find({ isSeriesTest: { $ne: true }, isIQRoomTest: { $ne: true } }).sort({
    createdAt: -1,
  });
};

export const getLeaderboardTests = async () => {
  return Test.aggregate([
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
};

export const getMyTests = async ({ userId, search = "" }) => {
  const filters = {
    "createdBy.userId": userId,
    isDeleted: { $ne: 1 },
  };

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  // Exclude series and IQ Room tests from normal user's test listings
  filters.isSeriesTest = { $ne: true };
  filters.isIQRoomTest = { $ne: true };

  return Test.find(filters)
    .populate("subjectId", "name")
    .sort({ createdAt: -1 });
};

export const getAssignedTests = async ({ search = "", userCreatedAt = null, studentId = null } = {}) => {
  // `isPublished` is the canonical "is this live" flag (see computeTestStatus,
  // which every publish/update path derives `status` from). Matching on the
  // literal string "PUBLISHED" instead used to exclude every series test
  // (whose status is always UPCOMING/ACTIVE/COMPLETED/DRAFT, never that exact
  // string) and any standalone test that had been rescheduled since being
  // published (which recomputes status away from "PUBLISHED" too).
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

  const tests = await Test.find(filters)
    .populate("subjectId", "name")
    .populate({
      path: "testSeriesId",
      select: "title description visibility createdAt",
    })
    .sort({ createdAt: -1 });

  if (studentId) {
    const assignments = await TestAssignment.find({
      studentId,
      testId: { $in: tests.map((t) => t._id) },
    }).lean();

    const assignmentMap = new Map(
      assignments.map((a) => [String(a.testId), a])
    );

    return tests
      .map((test) => {
        const assignment = assignmentMap.get(String(test._id));
        return {
          ...test.toObject(),
          id: String(test._id),
          assignmentStatus: assignment ? assignment.status : "PENDING",
        };
      })
      .filter((test) => test.assignmentStatus !== "HIDDEN");
  }

  return tests.map((test) => ({
    ...test.toObject(),
    id: String(test._id),
    assignmentStatus: "PENDING",
  }));
};
