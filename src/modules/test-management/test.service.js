import crypto from "crypto";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";

export async function createTest(data, user) {
  if (data.visibility === "ORG_ONLY" && !data.allowedOrganizations?.length)
    throw new Error("ORG_ONLY requires allowed organizations");

  if (data.questionMode === "MANUAL" && !data.questions?.length)
    throw new Error("MANUAL mode requires questions");

  if (data.questionMode === "RANDOM" && !data.randomConfig)
    throw new Error("RANDOM mode requires randomConfig");

  if (data.scheduleType === "DELAYED" && !data.delayDays)
    throw new Error("DELAYED requires delayDays");

  if (data.scheduleType === "FIXED" && (!data.startTime || !data.endTime))
    throw new Error("FIXED requires startTime & endTime");

  const test = await Test.create({
    ...data,
    testCode: data.visibility === "LINK_ONLY" ? crypto.randomBytes(4).toString("hex") : null,
    createdBy: { userId: user._id, role: user.role },
  });

  if (data.testSeriesId) {
    await TestSeries.findByIdAndUpdate(data.testSeriesId, { $addToSet: { tests: test._id } });
  }

  return test;
}

export async function updateTest(test, payload) {
  Object.assign(test, payload);
  await test.save();
  return test;
}

export async function deleteTest(test) {
  await test.deleteOne();
}
