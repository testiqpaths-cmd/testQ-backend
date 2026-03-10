import crypto from "crypto";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";

export async function createTest(data, user) {
  const test = await Test.create({
    ...data,
    testCode: data.visibility === "LINK_ONLY" ? crypto.randomBytes(4).toString("hex") : null,
    createdBy: { userId: user._id || user.id, role: user.role },
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
