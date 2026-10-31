import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import Test from "../src/models/test.model.js";
import Subject from "../src/models/subject.model.js";
import Topic from "../src/models/topic.model.js";
import { getStudentDashboardData } from "../src/modules/analytics/dashboard/dashboard.service.js";
import { evaluateObjectiveForAttempt } from "../src/modules/test-attempts/services/evaluateObjectiveAttempts.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function testSnapshotSemantics() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB for Snapshot Invalidation & Label Semantics Verification.\n");

  let tempTest = null;
  let tempAttempt = null;
  let tempSubject = null;
  let tempTopic = null;
  const tempStudentId = new mongoose.Types.ObjectId();

  try {
    // 1. Create temporary subject, topic, and test
    tempSubject = await Subject.create({ name: "Initial Subject 101", createdBy: tempStudentId });
    tempTopic = await Topic.create({ name: "Initial Topic Alpha", subjectId: tempSubject._id, createdBy: tempStudentId });
    tempTest = await Test.create({
      title: "Initial Test Title V1",
      subjectId: tempSubject._id,
      topicIds: [tempTopic._id],
      subjectIds: [tempSubject._id],
      duration: 30,
      totalQuestions: 1,
      totalMarks: 1,
      type: ["Standard"],
      visibility: "PUBLIC",
      createdBy: { userId: tempStudentId, role: "IQPATH_ADMIN" },
      scheduleType: "IMMEDIATE",
    });

    // 2. Create attempt for tempStudentId and evaluate it
    tempAttempt = await TestAttempt.create({
      testId: tempTest._id,
      studentId: tempStudentId,
      status: "SUBMITTED",
      duration: 30,
      endsAt: new Date(Date.now() + 1800000),
      submittedAt: new Date(),
      maxScore: 1,
      answers: [],
    });

    await evaluateObjectiveForAttempt(tempAttempt._id);
    const evaluatedAttempt = await TestAttempt.findById(tempAttempt._id).lean();

    console.log("==================================================================");
    console.log("STEP 1: Initial Snapshot Creation");
    console.log("==================================================================");
    console.log(`Snapshot Test Name: "${evaluatedAttempt.analyticsSnapshot.testName}"`);
    console.log(`Snapshot Subject:   "${evaluatedAttempt.analyticsSnapshot.subject}"`);
    console.log(`Snapshot Topic:     "${evaluatedAttempt.analyticsSnapshot.topic}"`);

    // Verify Dashboard displays initial label
    process.env.USE_ANALYTICS_SNAPSHOTS = "true";
    const initialDash = await getStudentDashboardData(String(tempStudentId));
    const testInDash = initialDash.allTests[0];
    console.log(`Dashboard Test:     "${testInDash.name}", Subject: "${testInDash.subject}", Topic: "${testInDash.topic}"`);

    // 3. Update Test title, subject name, topic name in database
    console.log("\n==================================================================");
    console.log("STEP 2: Modifying Test & Metadata (Simulating Creator Edit)");
    console.log("==================================================================");
    await Test.updateOne({ _id: tempTest._id }, { $set: { title: "Renamed Test Title V2" } });
    await Subject.updateOne({ _id: tempSubject._id }, { $set: { name: "Renamed Subject 202" } });
    await Topic.updateOne({ _id: tempTopic._id }, { $set: { name: "Renamed Topic Beta" } });
    console.log("Updated Test title to 'Renamed Test Title V2'");
    console.log("Updated Subject name to 'Renamed Subject 202'");
    console.log("Updated Topic name to 'Renamed Topic Beta'");

    // Verify Dashboard STILL preserves historical label via Snapshot (Audit Stability)
    const preservedDash = await getStudentDashboardData(String(tempStudentId));
    const preservedTest = preservedDash.allTests[0];
    console.log(`\nDashboard with Snapshot (Historical Preservation):`);
    console.log(`Name:    "${preservedTest.name}" (Preserved: ${preservedTest.name === "Initial Test Title V1"})`);
    console.log(`Subject: "${preservedTest.subject}" (Preserved: ${preservedTest.subject === "Initial Subject 101"})`);
    console.log(`Topic:   "${preservedTest.topic}" (Preserved: ${preservedTest.topic === "Initial Topic Alpha"})`);

    // 4. Trigger Re-evaluation (e.g. grade dispute or regrading)
    console.log("\n==================================================================");
    console.log("STEP 3: Triggering Re-evaluation");
    console.log("==================================================================");
    await evaluateObjectiveForAttempt(tempAttempt._id);
    const refreshedAttempt = await TestAttempt.findById(tempAttempt._id).lean();
    console.log(`Refreshed Snapshot Test Name: "${refreshedAttempt.analyticsSnapshot.testName}"`);
    console.log(`Refreshed Snapshot Subject:   "${refreshedAttempt.analyticsSnapshot.subject}"`);
    console.log(`Refreshed Snapshot Topic:     "${refreshedAttempt.analyticsSnapshot.topic}"`);

    const refreshedDash = await getStudentDashboardData(String(tempStudentId));
    const refreshedTest = refreshedDash.allTests[0];
    console.log(`\nDashboard after Re-evaluation:`);
    console.log(`Name:    "${refreshedTest.name}" (Updated: ${refreshedTest.name === "Renamed Test Title V2"})`);
    console.log(`Subject: "${refreshedTest.subject}" (Updated: ${refreshedTest.subject === "Renamed Subject 202"})`);
    console.log(`Topic:   "${refreshedTest.topic}" (Updated: ${refreshedTest.topic === "Renamed Topic Beta"})`);

    const semanticsPassed =
      preservedTest.name === "Initial Test Title V1" &&
      refreshedTest.name === "Renamed Test Title V2" &&
      refreshedTest.subject === "Renamed Subject 202";

    console.log("\n==================================================================");
    console.log(`RESULT: Snapshot Invalidation & Label Semantics: ${semanticsPassed ? "VERIFIED (PASSED)" : "FAILED"}`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Semantics test error:", err);
  } finally {
    // Cleanup temporary documents
    if (tempAttempt) await TestAttempt.deleteOne({ _id: tempAttempt._id });
    if (tempTest) await Test.deleteOne({ _id: tempTest._id });
    if (tempTopic) await Topic.deleteOne({ _id: tempTopic._id });
    if (tempSubject) await Subject.deleteOne({ _id: tempSubject._id });
    await mongoose.disconnect();
  }
}

testSnapshotSemantics();
