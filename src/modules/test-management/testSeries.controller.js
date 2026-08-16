import * as service from "./testSeries.service.js";
import logger from "../../config/logger.js";
import mongoose from "mongoose";
import TestSeries from "../../models/testSeries.model.js";
import TestSeriesAssignment from "../../models/testSeriesAssignment.model.js";
import TestAssignment from "../../models/testAssignment.model.js";
import { broadcastAssignedTestsChanged } from "../notification/notification.service.js";
import UserModel from "../../models/user.model.js";

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

// export const createSeries = async (req, res) => {
//   const series = await service.createSeries(req.body, req.user);
//   res.status(201).json({ success: true, data: series });

// };

export const createSeries = async (req, res, next) => {
  try {
    const { title, description, visibility, allowedOrganizations, allowedStudents, tests = [], plannedTestCount } = req.body;

    if (!title?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Title is required" });
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

    // ✅ validate test ids (prevents mongoose crash)
    const cleanedTests = (Array.isArray(tests) ? tests : []).filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );

    const series = await service.createSeries(
      {
        title: title.trim(),
        description: description?.trim() || "",
        visibility,
        allowedOrganizations,
        allowedStudents,
        tests: cleanedTests,
        plannedTestCount: cleanedPlannedTestCount,
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

    const series = await service.updateSeries(id, payload);

    // If client requested schedule update, compute start/end for tests
    if (Array.isArray(payload.tests) && payload.scheduleStart) {
      const Test = (await import('../../models/test.model.js')).default;

      // parse scheduleStart
      let cursor = new Date(payload.scheduleStart);
      if (Number.isNaN(cursor.getTime())) cursor = new Date();

      for (const testId of payload.tests) {
        try {
          const test = await Test.findById(testId);
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
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
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

    const assignment = await TestSeriesAssignment.findOneAndUpdate(
      { seriesId, studentId },
      { status: "ACCEPTED", acceptedAt: new Date() },
      { new: true, upsert: true }
    );

    if (Array.isArray(series.tests) && series.tests.length) {
      await TestAssignment.bulkWrite(
        series.tests.map((testId) => ({
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

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const declineSeriesAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const seriesId = req.series._id;

    const assignment = await TestSeriesAssignment.findOneAndUpdate(
      { seriesId, studentId },
      { status: "DECLINED", declinedAt: new Date() },
      { new: true, upsert: true }
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
