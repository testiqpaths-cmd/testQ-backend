import crypto from "crypto";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";
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

  // Compute and set status
  test.status = computeTestStatus(test);
  await test.save();

  // Trigger bulk notification dispatch asynchronously if not a draft
  if (test.status !== "Draft") {
    dispatchNotificationToStudents(user, {
      title: "New Test Assigned",
      message: `You have been assigned a new test: "${test.title}". Complete it before the deadline.`,
      type: "TEST_ASSIGNED",
      link: `/student/dashboard/tests/${test._id}/instructions`,
      metadata: { testId: test._id }
    }).catch(err => console.error("Notification dispatch failed", err));
  }

  return test;
}

export async function updateTest(test, payload, user) {
  const prevStatus = test.status || "DRAFT";
  
  Object.assign(test, payload);

  const hasFixedSchedule = Boolean(test.startTime && test.endTime);
  if (hasFixedSchedule) {
    test.scheduleType = "FIXED";
    test.isPublished = true;
  }

  // Compute and update status
  test.status = computeTestStatus(test);

  await test.save();

  // Dispatch notification if the test was just assigned/published
  if (prevStatus === "DRAFT" && (test.status === "UPCOMING" || test.status === "ACTIVE") && user) {
    dispatchNotificationToStudents(user, {
      title: "New Test Assigned",
      message: `You have been assigned a new test: "${test.title}". Complete it before the deadline.`,
      type: "TEST_ASSIGNED",
      link: `/student/dashboard/tests/${test._id}/instructions`,
      metadata: { testId: test._id }
    }).catch(err => console.error("Notification dispatch failed", err));
  }

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

export const getAssignedTests = async ({ search = "", userCreatedAt = null } = {}) => {
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
