import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TestSeries from "../src/models/testSeries.model.js";
import CompanyTrackAttempt from "../src/models/companyTrackAttempt.model.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";

const { Types } = mongoose;

const validateDoc = async (doc) => {
  try {
    await doc.validate();
    return null;
  } catch (err) {
    return err;
  }
};

describe("Step 2: Company-Wise Data Model Backward Compatibility & Schema Tests", () => {
  const dummyUserId = new Types.ObjectId();
  const dummyCompanyId = new Types.ObjectId();
  const dummyTestId1 = new Types.ObjectId();
  const dummyTestId2 = new Types.ObjectId();

  test("1. Existing TestSeries documents without new fields remain valid and acquire defaults", async () => {
    const legacyPayload = {
      title: "General Full Stack Assessment",
      description: "Legacy test series for college students",
      createdBy: {
        userId: dummyUserId,
        role: "IQPATH_ADMIN",
      },
      visibility: "PUBLIC",
      tests: [dummyTestId1, dummyTestId2],
    };

    const series = new TestSeries(legacyPayload);
    const err = await validateDoc(series);

    assert.equal(err, null, "Legacy TestSeries without new fields should validate cleanly");
    assert.equal(series.category, "GENERAL");
    assert.equal(series.mode, "SIMULATION");
    assert.equal(series.progressionMode, "SEQUENTIAL");
    assert.equal(series.experienceLevel, "FRESHER", "experienceLevel must default to FRESHER");
    assert.equal(series.targetRole, "Software Engineer", "targetRole must default to Software Engineer");
    assert.deepEqual(series.hiringRounds, [], "hiringRounds must default to empty array");
  });

  test("2. Existing GENERAL and COMPANY series retain their current defaults and behavior", async () => {
    const companySeriesPayload = {
      title: "TCS National Qualifier Track",
      createdBy: {
        userId: dummyUserId,
        role: "IQPATH_ADMIN",
      },
      visibility: "PUBLIC",
      category: "COMPANY",
      companyId: dummyCompanyId,
      mode: "SIMULATION",
      progressionMode: "SEQUENTIAL",
      passingPercentage: 60,
      roundsConfig: [
        {
          stageOrder: 1,
          stageKey: "ROUND_1",
          stageName: "Cognitive",
          cutoffPercentage: 50,
          retakePolicy: "ALL_TESTS",
        },
      ],
      tests: [dummyTestId1],
    };

    const companySeries = new TestSeries(companySeriesPayload);
    const err = await validateDoc(companySeries);

    assert.equal(err, null, "Company series with legacy roundsConfig must validate cleanly");
    assert.equal(companySeries.category, "COMPANY");
    assert.equal(String(companySeries.companyId), String(dummyCompanyId));
    assert.equal(companySeries.roundsConfig.length, 1);
    assert.equal(companySeries.roundsConfig[0].cutoffPercentage, 50);
  });

  test("3. New experience fields accept valid values and reject invalid values", async () => {
    const validLevels = ["FRESHER", "EXPERIENCED_1_3", "EXPERIENCED_3_PLUS", "ALL"];
    for (const level of validLevels) {
      const series = new TestSeries({
        title: `Track ${level}`,
        createdBy: { userId: dummyUserId, role: "IQPATH_ADMIN" },
        visibility: "PUBLIC",
        experienceLevel: level,
        targetRole: "Cloud Engineer",
      });
      assert.equal(await validateDoc(series), null, `Valid experienceLevel '${level}' should pass validation`);
      assert.equal(series.experienceLevel, level);
      assert.equal(series.targetRole, "Cloud Engineer");
    }

    const invalidSeries = new TestSeries({
      title: "Invalid Track",
      createdBy: { userId: dummyUserId, role: "IQPATH_ADMIN" },
      visibility: "PUBLIC",
      experienceLevel: "EXPERIENCED_10_YEARS", // Invalid enum value
    });
    const err = await validateDoc(invalidSeries);
    assert.notEqual(err, null, "Invalid experienceLevel enum must trigger validation error");
    assert.ok(err.errors["experienceLevel"], "Error must be on experienceLevel field");
  });

  test("4. TESTS rounds can reference multiple existing tests", async () => {
    const series = new TestSeries({
      title: "Wipro Multi-Test Round Track",
      createdBy: { userId: dummyUserId, role: "IQPATH_ADMIN" },
      visibility: "PUBLIC",
      category: "COMPANY",
      companyId: dummyCompanyId,
      hiringRounds: [
        {
          roundOrder: 1,
          roundKey: "ROUND_1",
          roundName: "Aptitude & Coding Assessment",
          roundType: "TESTS",
          cutoffPercentage: 65,
          weight: 40,
          retakePolicy: "ALL_TESTS",
          tests: [dummyTestId1, dummyTestId2],
        },
      ],
    });

    const err = await validateDoc(series);
    assert.equal(err, null, "TESTS round configuration should validate cleanly");
    assert.equal(series.hiringRounds.length, 1);
    assert.equal(series.hiringRounds[0].tests.length, 2);
    assert.equal(series.hiringRounds[0].roundType, "TESTS");
    assert.equal(series.hiringRounds[0].cutoffPercentage, 65);
    assert.equal(series.hiringRounds[0].weight, 40);
  });

  test("5. AI_INTERVIEW rounds can store their interview configuration", async () => {
    const series = new TestSeries({
      title: "Infosys Placement Simulation with AI Interview",
      createdBy: { userId: dummyUserId, role: "IQPATH_ADMIN" },
      visibility: "PUBLIC",
      category: "COMPANY",
      companyId: dummyCompanyId,
      hiringRounds: [
        {
          roundOrder: 1,
          roundKey: "ROUND_1",
          roundName: "Online Assessment",
          roundType: "TESTS",
          tests: [dummyTestId1],
        },
        {
          roundOrder: 2,
          roundKey: "ROUND_2",
          roundName: "Technical & Behavioral AI Interview",
          roundType: "AI_INTERVIEW",
          cutoffPercentage: 70,
          weight: 60,
          retakePolicy: "FAILED_ONLY",
          aiInterviewConfig: {
            role: "Systems Engineer",
            experienceLevel: "Fresher",
            topics: ["DATA_STRUCTURES", "SYSTEM_DESIGN", "COMMUNICATION"],
            duration: 35,
            difficulty: "MEDIUM",
            customRubric: "Assess algorithmic efficiency, STAR behavioral responses, and OOP principles.",
            interviewTypes: ["technical", "behavioral"],
          },
        },
      ],
    });

    const err = await validateDoc(series);
    assert.equal(err, null, "AI_INTERVIEW round configuration should validate cleanly");
    assert.equal(series.hiringRounds.length, 2);
    const round2 = series.hiringRounds[1];
    assert.equal(round2.roundType, "AI_INTERVIEW");
    assert.equal(round2.aiInterviewConfig.role, "Systems Engineer");
    assert.equal(round2.aiInterviewConfig.duration, 35);
    assert.equal(round2.aiInterviewConfig.difficulty, "MEDIUM");
    assert.equal(round2.aiInterviewConfig.topics.length, 3);
    assert.ok(round2.aiInterviewConfig.customRubric.includes("STAR behavioral"));
  });

  test("6. Existing InterviewSession creation works without any company-track fields", async () => {
    const session = new InterviewSession({
      userId: dummyUserId,
      interviewId: "int-standalone-001",
      interviewType: "CUSTOM",
      role: "Backend Engineer",
      experienceLevel: "1-3 Years",
      duration: 30,
    });

    const err = await validateDoc(session);
    assert.equal(err, null, "Standalone InterviewSession must validate cleanly without company-track fields");
    assert.equal(session.companyId, null, "companyId should default to null");
    assert.equal(session.trackId, null, "trackId should default to null");
    assert.equal(session.trackAttemptId, null, "trackAttemptId should default to null");
    assert.equal(session.customRubric, null, "customRubric should default to null");
  });

  test("7. InterviewSession accepts optional company-track metadata", async () => {
    const dummyTrackId = new Types.ObjectId();
    const dummyTrackAttemptId = new Types.ObjectId();

    const session = new InterviewSession({
      userId: dummyUserId,
      interviewId: "int-track-002",
      interviewType: "CUSTOM",
      role: "Software Engineer",
      duration: 45,
      companyId: dummyCompanyId,
      trackId: dummyTrackId,
      trackAttemptId: dummyTrackAttemptId,
      customRubric: "Company core values: Customer Obsession, Ownership, High Standards.",
    });

    const err = await validateDoc(session);
    assert.equal(err, null, "InterviewSession with company track metadata should validate cleanly");
    assert.equal(String(session.companyId), String(dummyCompanyId));
    assert.equal(String(session.trackId), String(dummyTrackId));
    assert.equal(String(session.trackAttemptId), String(dummyTrackAttemptId));
    assert.equal(session.customRubric, "Company core values: Customer Obsession, Ownership, High Standards.");
  });

  test("8. CompanyTrackAttempt validates required references, status values and attempt numbers", async () => {
    const dummyTrackId = new Types.ObjectId();

    // 8a: Missing required fields
    const invalidAttempt = new CompanyTrackAttempt({});
    const errMissing = await validateDoc(invalidAttempt);
    assert.notEqual(errMissing, null, "Missing required fields must fail validation");
    assert.ok(errMissing.errors["studentId"]);
    assert.ok(errMissing.errors["trackId"]);
    assert.ok(errMissing.errors["companyId"]);

    // 8b: Valid full attempt
    const validAttempt = new CompanyTrackAttempt({
      studentId: dummyUserId,
      trackId: dummyTrackId,
      companyId: dummyCompanyId,
      driveAttemptNumber: 1,
      status: "IN_PROGRESS",
      currentRoundOrder: 1,
      roundAttempts: [
        {
          roundOrder: 1,
          roundKey: "ROUND_1",
          roundName: "Online Assessment",
          roundType: "TESTS",
          status: "PASSED",
          scoreObtained: 45,
          maxScore: 50,
          percentage: 90,
          cutoffPercentage: 50,
          testAttemptIds: [dummyTestId1],
          evaluatedAt: new Date(),
        },
        {
          roundOrder: 2,
          roundKey: "ROUND_2",
          roundName: "AI Interview",
          roundType: "AI_INTERVIEW",
          status: "READY",
          scoreObtained: 0,
          maxScore: 100,
          percentage: 0,
          cutoffPercentage: 70,
          interviewSessionId: "int-session-uuid-1234",
        },
      ],
      overallScore: 45,
      overallPercentage: 90,
      overallReadinessBand: "Advanced Placement Readiness",
      summaryRecommendations: ["Strengthen dynamic programming", "Maintain strong behavioral communication"],
    });

    const errValid = await validateDoc(validAttempt);
    assert.equal(errValid, null, "Complete CompanyTrackAttempt must validate cleanly");
    assert.equal(validAttempt.status, "IN_PROGRESS");
    assert.equal(validAttempt.driveAttemptNumber, 1);
    assert.equal(validAttempt.roundAttempts.length, 2);
    assert.equal(validAttempt.roundAttempts[1].interviewSessionId, "int-session-uuid-1234");
    assert.equal(validAttempt.summaryRecommendations.length, 2);

    // 8c: Invalid status enum
    const invalidStatusAttempt = new CompanyTrackAttempt({
      studentId: dummyUserId,
      trackId: dummyTrackId,
      companyId: dummyCompanyId,
      status: "HIRED_UNKNOWN",
    });
    const errStatus = await validateDoc(invalidStatusAttempt);
    assert.notEqual(errStatus, null);
    assert.ok(errStatus.errors["status"], "Invalid status must fail validation");
  });

  test("9. Unique index definitions match the intended attempt identity", () => {
    const indexes = CompanyTrackAttempt.schema.indexes();

    const uniqueCompoundIndex = indexes.find(
      ([fields, options]) =>
        fields.studentId === 1 &&
        fields.trackId === 1 &&
        fields.driveAttemptNumber === 1 &&
        options?.unique === true
    );
    assert.ok(
      uniqueCompoundIndex,
      "CompanyTrackAttempt must have a unique compound index on { studentId: 1, trackId: 1, driveAttemptNumber: 1 }"
    );

    const seriesIndexes = TestSeries.schema.indexes();
    const experienceIndex = seriesIndexes.find(
      ([fields]) =>
        fields.category === 1 &&
        fields.companyId === 1 &&
        fields.experienceLevel === 1
    );
    assert.ok(
      experienceIndex,
      "TestSeries must have compound index on { category: 1, companyId: 1, experienceLevel: 1 }"
    );
  });

  test("10. Importing the new model does not introduce circular dependency or startup errors", async () => {
    // Dynamic import verifies all dependent models resolve cleanly without circular deadlocks
    const importedAttemptModel = (await import("../src/models/companyTrackAttempt.model.js")).default;
    const importedSeriesModel = (await import("../src/models/testSeries.model.js")).default;
    const importedInterviewSession = (await import("../src/ai-interview/schemas/interview-session.schema.js")).InterviewSession;

    assert.ok(importedAttemptModel, "CompanyTrackAttempt must export valid Mongoose model");
    assert.ok(importedSeriesModel, "TestSeries must export valid Mongoose model");
    assert.ok(importedInterviewSession, "InterviewSession must export valid Mongoose model");
    assert.equal(importedAttemptModel.modelName, "CompanyTrackAttempt");
  });
});
