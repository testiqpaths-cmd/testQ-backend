import * as service from "./testSeries.service.js";
import logger from "../../config/logger.js";
import mongoose from "mongoose";
import TestSeries from "../../models/testSeries.model.js";
import TestSeriesAssignment from "../../models/testSeriesAssignment.model.js";
import TestAssignment from "../../models/testAssignment.model.js";
import { broadcastAssignedTestsChanged } from "../notification/notification.service.js";
import UserModel from "../../models/user.model.js";
import { hasTestEnded } from "./utils/status.js";

// Fall back to a DB lookup for tokens issued before organizationId was
// embedded in the JWT payload.
const resolveOrganizationId = async (user) => {
  if (!user) return null;
  if (user.organizationId) return user.organizationId;
  const dbUser = await UserModel.findById(user._id || user.id).select("organizationId").lean();
  return dbUser?.organizationId ?? null;
};

// Same ownership rule as test.controller.js's canManageTest: admins can
// manage any series, an org/creator can only manage their own.
const canManageSeries = (series, user) => {
  if (!series || !user) return false;
  if (user.role === "IQPATH_ADMIN") return true;

  const ownerId =
    typeof series.createdBy?.userId === "object"
      ? series.createdBy?.userId?.toString?.()
      : String(series.createdBy?.userId || "");

  const requesterId = String(user._id || user.id || "");
  return ownerId && requesterId && ownerId === requesterId;
};

export const getSeriesStats = async (req, res) => {
  try {
    if (!canManageSeries(req.series, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const stats = await service.getSeriesStats(req.series._id);
    return res.json({
      success: true,
      data: {
        ...stats,
        series: { _id: req.series._id, title: req.series.title },
      },
    });
  } catch (err) {
    logger.error(`getSeriesStats error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
  }
};

import Company from "../../models/company.model.js";
import Test from "../../models/test.model.js";

const ALLOWED_EXPERIENCE_LEVELS = ["FRESHER", "EXPERIENCED_1_3", "EXPERIENCED_3_PLUS", "ALL"];
const ALLOWED_ROUND_TYPES = ["TESTS", "AI_INTERVIEW"];
const ALLOWED_RETAKE_POLICIES = ["ALL_TESTS", "FAILED_ONLY"];

export const validateHiringRoundsAndReferences = async ({ companyId, hiringRounds, experienceLevel, category }) => {
  if (category === "COMPANY" || companyId) {
    if (!companyId) {
      const err = new Error("Company ID is required for Company tracks");
      err.statusCode = 400;
      throw err;
    }
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      const err = new Error("Invalid company ID format");
      err.statusCode = 400;
      throw err;
    }
    const companyExists = await Company.findById(companyId).select("_id name").lean();
    if (!companyExists) {
      const err = new Error("Referenced company does not exist");
      err.statusCode = 400;
      throw err;
    }
  }

  if (experienceLevel && !ALLOWED_EXPERIENCE_LEVELS.includes(experienceLevel)) {
    const err = new Error(`Invalid experience level "${experienceLevel}". Allowed: ${ALLOWED_EXPERIENCE_LEVELS.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  if (!hiringRounds || !Array.isArray(hiringRounds) || hiringRounds.length === 0) {
    return [];
  }

  const seenOrders = new Set();
  const seenKeys = new Set();
  const allReferencedTestIds = [];
  const validatedRounds = [];

  for (let i = 0; i < hiringRounds.length; i++) {
    const r = hiringRounds[i];
    const order = Number(r.roundOrder);
    if (!Number.isInteger(order) || order < 1) {
      const err = new Error(`Round at index ${i} must have a valid positive integer roundOrder`);
      err.statusCode = 400;
      throw err;
    }
    if (seenOrders.has(order)) {
      const err = new Error(`Duplicate roundOrder ${order} found in hiring rounds`);
      err.statusCode = 400;
      throw err;
    }
    seenOrders.add(order);

    const roundKey = String(r.roundKey || "").trim();
    if (!roundKey) {
      const err = new Error(`Round at order ${order} requires a roundKey`);
      err.statusCode = 400;
      throw err;
    }
    const normKey = roundKey.toLowerCase();
    if (seenKeys.has(normKey)) {
      const err = new Error(`Duplicate roundKey "${roundKey}" found in hiring rounds`);
      err.statusCode = 400;
      throw err;
    }
    seenKeys.add(normKey);

    const roundName = String(r.roundName || "").trim();
    if (!roundName) {
      const err = new Error(`Round "${roundKey}" requires a roundName`);
      err.statusCode = 400;
      throw err;
    }

    if (!ALLOWED_ROUND_TYPES.includes(r.roundType)) {
      const err = new Error(`Round "${roundName}" has invalid roundType "${r.roundType}". Must be TESTS or AI_INTERVIEW`);
      err.statusCode = 400;
      throw err;
    }

    const cutoff = r.cutoffPercentage !== undefined ? Number(r.cutoffPercentage) : 50;
    if (Number.isNaN(cutoff) || cutoff < 0 || cutoff > 100) {
      const err = new Error(`Round "${roundName}" cutoff percentage must be between 0 and 100`);
      err.statusCode = 400;
      throw err;
    }

    const weight = r.weight !== undefined ? Number(r.weight) : 100;
    if (Number.isNaN(weight) || weight < 0) {
      const err = new Error(`Round "${roundName}" weight must be a non-negative number`);
      err.statusCode = 400;
      throw err;
    }

    const retakePolicy = r.retakePolicy || "ALL_TESTS";
    if (!ALLOWED_RETAKE_POLICIES.includes(retakePolicy)) {
      const err = new Error(`Round "${roundName}" has invalid retakePolicy "${retakePolicy}"`);
      err.statusCode = 400;
      throw err;
    }

    const validatedRound = {
      roundOrder: order,
      roundKey,
      roundName,
      roundType: r.roundType,
      cutoffPercentage: cutoff,
      weight,
      retakePolicy,
      tests: [],
      aiInterviewConfig: null,
    };

    if (r.roundType === "TESTS") {
      const tests = Array.isArray(r.tests) ? r.tests : [];
      if (tests.length === 0) {
        const err = new Error(`Round "${roundName}" is a TESTS round and must include at least one test`);
        err.statusCode = 400;
        throw err;
      }
      for (const tId of tests) {
        const strId = String(tId?._id || tId);
        if (!mongoose.Types.ObjectId.isValid(strId)) {
          const err = new Error(`Invalid test ID "${strId}" in round "${roundName}"`);
          err.statusCode = 400;
          throw err;
        }
        validatedRound.tests.push(new mongoose.Types.ObjectId(strId));
        allReferencedTestIds.push(strId);
      }
    } else if (r.roundType === "AI_INTERVIEW") {
      const cfg = r.aiInterviewConfig || {};
      validatedRound.aiInterviewConfig = {
        role: cfg.role ? String(cfg.role).trim() : null,
        experienceLevel: cfg.experienceLevel || null,
        interviewTypes: Array.isArray(cfg.interviewTypes) ? cfg.interviewTypes : [],
        topics: Array.isArray(cfg.topics) ? cfg.topics.map((t) => String(t).trim()).filter(Boolean) : [],
        durationMinutes: cfg.durationMinutes ? Number(cfg.durationMinutes) : 30,
        difficulty: cfg.difficulty || "MEDIUM",
        customRubric: cfg.customRubric || null,
      };
      if (
        validatedRound.aiInterviewConfig.durationMinutes < 5 ||
        validatedRound.aiInterviewConfig.durationMinutes > 180
      ) {
        const err = new Error(`Interview duration in round "${roundName}" must be between 5 and 180 minutes`);
        err.statusCode = 400;
        throw err;
      }
    }

    validatedRounds.push(validatedRound);
  }

  // Validate that all referenced tests actually exist in the database and are not soft-deleted
  if (allReferencedTestIds.length > 0) {
    const uniqueIds = [...new Set(allReferencedTestIds)];
    const existing = await Test.find({
      _id: { $in: uniqueIds },
      isDeleted: { $ne: 1 },
    }).select("_id").lean();

    const existingIdSet = new Set(existing.map((doc) => doc._id.toString()));
    const missing = uniqueIds.filter((id) => !existingIdSet.has(id));
    if (missing.length > 0) {
      const err = new Error(`Referenced test(s) do not exist or have been deleted: ${missing.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }
  }

  return validatedRounds;
};

export const createSeries = async (req, res, next) => {
  try {
    const {
      title,
      description,
      visibility,
      allowedOrganizations,
      allowedStudents,
      tests = [],
      plannedTestCount,
      category,
      companyId,
      mode,
      progressionMode,
      patternVersion,
      passingPercentage,
      roundsConfig,
      experienceLevel,
      targetRole,
      hiringRounds,
      launchDate,
    } = req.body;

    if (!title?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Title is required" });
    }

    if (category === "COMPANY" && req.user?.role !== "IQPATH_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only IQPATH_ADMIN is authorized to create company placement tracks",
      });
    }

    let cleanedPlannedTestCount;
    if (plannedTestCount !== undefined && plannedTestCount !== null && plannedTestCount !== "") {
      const parsed = Number(plannedTestCount);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({
          success: false,
          message: "Total tests planned must be a whole number of 0 or more",
        });
      }
      cleanedPlannedTestCount = parsed;
    }

    // Validate hiring rounds and company/test references
    const validatedHiringRounds = await validateHiringRoundsAndReferences({
      companyId,
      hiringRounds,
      experienceLevel,
      category,
    });

    // Validate test ids (prevents mongoose crash)
    const cleanedTests = (Array.isArray(tests) ? tests : []).filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );

    // Merge round tests into series.tests for unified indexing and backward compatibility
    const roundTestIds = validatedHiringRounds.flatMap((r) => r.tests.map((t) => t.toString()));
    const mergedTests = [...new Set([...cleanedTests.map((t) => t.toString()), ...roundTestIds])];

    const series = await service.createSeries(
      {
        title: title.trim(),
        description: description?.trim() || "",
        visibility,
        allowedOrganizations,
        allowedStudents,
        tests: mergedTests,
        plannedTestCount: cleanedPlannedTestCount,
        category: category || "GENERAL",
        companyId: companyId && mongoose.Types.ObjectId.isValid(companyId) ? companyId : null,
        mode: mode || "SIMULATION",
        progressionMode: progressionMode || "SEQUENTIAL",
        patternVersion: patternVersion || "2026",
        passingPercentage: typeof passingPercentage === "number" ? passingPercentage : 50,
        roundsConfig: Array.isArray(roundsConfig) ? roundsConfig : [],
        experienceLevel: experienceLevel || "ALL",
        targetRole: targetRole || null,
        hiringRounds: validatedHiringRounds,
        launchDate,
      },
      req.user
    );

    return res.status(201).json({
      success: true,
      message: "Test series created successfully",
      data: series,
    });
  } catch (err) {
    logger.error(`createSeries error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const launchSeries = async (req, res, next) => {
  try {
    if (!canManageSeries(req.series, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden: You cannot manage this test series" });
    }

    const { launchDate, launchNow } = req.body || {};
    const updated = await service.launchSeries(
      req.series._id,
      { launchDate, launchNow },
      req.user
    );

    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    return res.json({
      success: true,
      message: updated.isLaunched
        ? "Test series launched successfully"
        : "Test series scheduled successfully",
      data: updated,
    });
  } catch (err) {
    logger.error(`launchSeries error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const updateSeries = async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body || {};

    // Authorization checks for ORGANIZATION users
    if (req.user?.role === "ORGANIZATION") {
      if (req.series?.category === "COMPANY" || payload.category === "COMPANY") {
        return res.status(403).json({
          success: false,
          message: "Organization users are not permitted to modify company placement tracks",
        });
      }
      const creatorId = String(req.series?.createdBy?.userId || "");
      const requesterId = String(req.user._id || req.user.id || "");
      if (creatorId && requesterId && creatorId !== requesterId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You can only update test series created by your organization",
        });
      }
    }

    if (payload.plannedTestCount !== undefined && payload.plannedTestCount !== null && payload.plannedTestCount !== "") {
      const parsed = Number(payload.plannedTestCount);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({
          success: false,
          message: "Total tests planned must be a whole number of 0 or more",
        });
      }
      payload.plannedTestCount = parsed;
    }

    // Validate hiring rounds and company/test references only when hiringRounds is explicitly provided
    if (payload.hiringRounds !== undefined) {
      const validatedHiringRounds = await validateHiringRoundsAndReferences({
        companyId: payload.companyId !== undefined ? payload.companyId : req.series?.companyId,
        hiringRounds: payload.hiringRounds,
        experienceLevel: payload.experienceLevel !== undefined ? payload.experienceLevel : req.series?.experienceLevel,
        category: payload.category !== undefined ? payload.category : req.series?.category,
      });
      payload.hiringRounds = validatedHiringRounds;

      if (validatedHiringRounds.length > 0) {
        const roundTestIds = validatedHiringRounds.flatMap((r) => r.tests.map((t) => t.toString()));
        const existingTests = Array.isArray(payload.tests) ? payload.tests.map((t) => t.toString()) : [];
        payload.tests = [...new Set([...existingTests, ...roundTestIds])];
      }
    }

    const series = await service.updateSeries(id, payload);

    // If client requested schedule update, compute start/end for tests
    if (Array.isArray(payload.tests) && payload.scheduleStart) {
      const TestModel = (await import('../../models/test.model.js')).default;

      // parse scheduleStart
      let cursor = new Date(payload.scheduleStart);
      if (Number.isNaN(cursor.getTime())) cursor = new Date();

      for (const testId of payload.tests) {
        try {
          const test = await TestModel.findById(testId);
          if (!test) continue;

          const durationMinutes = Number(test.duration) || 0;
          const startTime = new Date(cursor);
          const endTime = new Date(cursor.getTime() + durationMinutes * 60 * 1000);

          test.startTime = startTime;
          test.endTime = endTime;
          await test.save();

          // advance cursor
          cursor = endTime;
        } catch (e) {
          // continue on per-test error
          logger.error(`updateSeries: failed to update schedule for test ${testId}: ${e.message}`);
        }
      }
    }

    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    res.json({ success: true, data: series });
  } catch (err) {
    logger.error(`updateSeries error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};

export const deleteSeries = async (req, res) => {
  await service.deleteSeries(req.params.id);
  broadcastAssignedTestsChanged(req.user).catch((err) =>
    logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
  );
  res.json({ success: true });
};

export const getSeries = async (req, res) => {
  const series = await service.getSeriesById(req.params.id);
  res.json({ success: true, data: series });
};

export const getSeriesList = async (req, res, next) => {
  try {
    const series = req.query.leaderboard === "true"
      ? await service.getLeaderboardSeriesList({
        userId: req.user?._id || req.user?.id,
        userRole: req.user?.role,
        userOrganizationId: req.user?.role === "ORGANIZATION" ? await resolveOrganizationId(req.user) : null,
      })
      : await service.getSeriesList({
        userId: req.user?._id || req.user?.id,
        search: req.query.search || "",
      });

    return res.json({
      success: true,
      data: series,
    });
  } catch (err) {
    logger.error(`getSeriesList error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const createSeriesTest = async (req, res, next) => {
  try {
    const seriesId = req.params.id;
    const data = req.body;

    // basic validation
    if (!seriesId) {
      return res.status(400).json({ success: false, message: 'Series id is required' });
    }

    const TestSeriesService = await import('./testSeries.service.js');
    const test = await TestSeriesService.createSeriesTest(seriesId, data, req.user);

    broadcastAssignedTestsChanged(req.user, test).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    return res.status(201).json({ success: true, data: test });
  } catch (err) {
    logger.error(`createSeriesTest error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};

// Accepting a series accepts every test currently in it in one step — bulk
// upserts a real ACCEPTED TestAssignment for each of the series' tests, so
// starting any of them satisfies the existing per-test acceptance gate in
// startTestAttemptController without that controller needing to know
// anything about series at all. (A test added to the series LATER, after a
// student already accepted it, is auto-accepted too — see createSeriesTest
// in testSeries.service.js.)
export const acceptSeriesAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const series = req.series;
    const seriesId = series._id;

    const now = new Date();
    const childTests = Array.isArray(series.tests) && series.tests.length
      ? await Test.find({ _id: { $in: series.tests }, isDeleted: 0, isPublished: true })
          .select("_id scheduleType startTime endTime isPublished")
          .lean()
      : [];

    if (childTests.length > 0) {
      const allExpired = childTests.every(
        (t) => hasTestEnded(t, now) || (t.endTime && now > new Date(t.endTime))
      );
      if (allExpired) {
        return res.status(400).json({
          success: false,
          message: "This test series has already ended and can no longer be accepted.",
        });
      }
    }

    const assignment = await TestSeriesAssignment.findOneAndUpdate(
      { seriesId, studentId },
      { status: "ACCEPTED", acceptedAt: new Date() },
      { new: true, upsert: true }
    );

    // Rule E: When accepting the series, do not newly accept already-expired child tests
    const eligibleTestIds = childTests
      .filter((t) => !hasTestEnded(t, now) && !(t.endTime && now > new Date(t.endTime)))
      .map((t) => t._id);

    if (eligibleTestIds.length) {
      await TestAssignment.bulkWrite(
        eligibleTestIds.map((testId) => ({
          updateOne: {
            filter: { testId, studentId },
            update: {
              $set: { status: "ACCEPTED", acceptedAt: new Date() },
              $setOnInsert: { testId, studentId },
            },
            upsert: true,
          },
        }))
      );
    }

    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const declineSeriesAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const series = req.series;
    const seriesId = series._id;

    const now = new Date();
    const childTests = Array.isArray(series.tests) && series.tests.length
      ? await Test.find({ _id: { $in: series.tests }, isDeleted: 0, isPublished: true })
          .select("_id scheduleType startTime endTime isPublished")
          .lean()
      : [];

    if (childTests.length > 0) {
      const allExpired = childTests.every(
        (t) => hasTestEnded(t, now) || (t.endTime && now > new Date(t.endTime))
      );
      if (allExpired) {
        return res.status(400).json({
          success: false,
          message: "This test series has already ended and can no longer be declined.",
        });
      }
    }

    const assignment = await TestSeriesAssignment.findOneAndUpdate(
      { seriesId, studentId },
      { status: "DECLINED", declinedAt: new Date() },
      { new: true, upsert: true }
    );

    if (Array.isArray(series.tests) && series.tests.length) {
      await TestAssignment.bulkWrite(
        series.tests.map((testId) => ({
          updateOne: {
            filter: { testId, studentId },
            update: {
              $set: { status: "DECLINED", declinedAt: new Date() },
              $setOnInsert: { testId, studentId },
            },
            upsert: true,
          },
        }))
      );
    }

    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const pendingSeriesAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const seriesId = req.series._id;

    const assignment = await TestSeriesAssignment.findOneAndUpdate(
      { seriesId, studentId },
      { status: "PENDING" },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const hideSeriesAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const seriesId = req.series._id;

    const assignment = await TestSeriesAssignment.findOneAndUpdate(
      { seriesId, studentId },
      { status: "HIDDEN", hiddenAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};
