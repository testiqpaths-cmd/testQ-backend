import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import TestAttempt from "../../src/models/testAttempt.model.js";
import User from "../../src/modules/auth/models/User.model.js";
import Test from "../../src/models/test.model.js";
import Organization from "../../src/models/organization.model.js";

async function explainOrgQuery() {
  await mongoose.connect(process.env.MONGO_URI);

  const org = await Organization.findOne({ isDeleted: { $ne: 1 } }).lean();
  if (!org) {
    console.log("No organization found");
    await mongoose.disconnect();
    return;
  }

  const [scopedTests, scopedStudents] = await Promise.all([
    Test.find({ "createdBy.role": "ORGANIZATION", "createdBy.userId": org.createdBy?.userId }).select("_id").lean(),
    User.find({ organizationId: org._id }).select("_id").lean(),
  ]);

  const testIds = scopedTests.map((t) => t._id);
  const studentIds = scopedStudents.map((s) => s._id);

  console.log(`Org: ${org.name}, tests: ${testIds.length}, students: ${studentIds.length}`);

  const explainOrg = await TestAttempt.find({
    status: { $in: ["SUBMITTED", "EVALUATED"] },
    testId: { $in: testIds },
    studentId: { $in: studentIds },
  })
    .sort({ submittedAt: -1, updatedAt: -1 })
    .limit(100)
    .explain("executionStats");

  const stage = explainOrg.executionStats?.executionStages;
  console.log("=== Execution Stats for Org Stream 3 ===");
  console.log(`Winning plan stage: ${stage?.stage}`);
  console.log(`Total docs examined: ${explainOrg.executionStats?.totalDocsExamined}`);
  console.log(`Total keys examined: ${explainOrg.executionStats?.totalKeysExamined}`);
  console.log(`Execution time: ${explainOrg.executionStats?.executionTimeMillis}ms`);

  await mongoose.disconnect();
}

explainOrgQuery();
