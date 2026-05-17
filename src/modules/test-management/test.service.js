import crypto from "crypto";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";
import { computeTestStatus } from "./utils/status.js";

export async function createTest(data, user) {
  // Prevent creating series tests via the normal test creation flow.
  if (data.testSeriesId) {
    throw new Error("Series tests must be created via the Test Series flow");
  }

  const payload = {
    ...data,
    maxAttempts: Number(data.maxAttempts) || 1,
    testCode: data.visibility === "LINK_ONLY" ? crypto.randomBytes(4).toString("hex") : null,
    createdBy: { userId: user._id || user.id, role: user.role },
  };

  const test = await Test.create(payload);

  // Compute and set status
  test.status = computeTestStatus(test);
  await test.save();
  return test;
}

export async function updateTest(test, payload) {
  Object.assign(test, payload);

  const hasFixedSchedule = Boolean(test.startTime && test.endTime);
  if (hasFixedSchedule) {
    test.scheduleType = "FIXED";
    test.isPublished = true;
  }

  // Compute and update status
  test.status = computeTestStatus(test);

  await test.save();
  return test;
}

export async function deleteTest(test) {
  await test.deleteOne();
}

export const getAllTests = async () => {
  // Exclude tests that belong to a series
  return await Test.find({ isSeriesTest: { $ne: true } }).sort({ createdAt: -1 });
};

export const getMyTests = async ({ userId, search = "" }) => {
  const filters = {
    "createdBy.userId": userId,
  };

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  // Exclude series tests from normal user's test listings
  filters.isSeriesTest = { $ne: true };

  return Test.find(filters)
    .populate("subjectId", "name")
    .sort({ createdAt: -1 });
};

export const getAssignedTests = async ({ search = "" } = {}) => {
  const filters = { isPublished: true };

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return Test.find(filters)
    .populate('subjectId', 'name')
    .populate({ path: 'testSeriesId', select: 'title description visibility createdAt' })
    .sort({ createdAt: -1 });
};