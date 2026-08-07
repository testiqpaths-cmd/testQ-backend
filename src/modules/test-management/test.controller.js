import * as service from "./test.service.js";
import logger from "../../config/logger.js";
import { computeTestStatus } from "./utils/status.js";
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

const canManageTest = (test, user) => {
  if (!test || !user) return false;

  if (user.role === "IQPATH_ADMIN") return true;

  const ownerId =
    typeof test.createdBy?.userId === "object"
      ? test.createdBy?.userId?.toString?.()
      : String(test.createdBy?.userId || "");

  const requesterId = String(user._id || user.id || "");
  return ownerId && requesterId && ownerId === requesterId;
};

export const createTest = async (req, res) => {
  try {
    if (!req.user?._id && !req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const created = await service.createTest(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: "Test created successfully",
      data: created,
    });
  } catch (err) {
    logger.error(`createTest error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export async function getTest(req, res) {
  try {
    if (req.user?.role === "STUDENT") {
      const User = (await import("../../modules/auth/models/User.model.js")).default;
      const dbUser = await User.findById(req.user._id || req.user.id).select("createdAt");
      if (dbUser && req.test?.createdAt && new Date(req.test.createdAt) < new Date(dbUser.createdAt)) {
        return res.status(403).json({
          success: false,
          message: "You cannot access a test created before your registration date",
        });
      }
    }
    res.json({ success: true, data: req.test });
  } catch (err) {
    logger.error(`getTest error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateTest(req, res, next) {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const test = await service.updateTest(req.test, req.body, req.user);
    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );
    res.json({ success: true, data: test });
  } catch (e) {
    next(e);
  }
}

export async function deleteTest(req, res, next) {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await service.deleteTest(req.test);
    broadcastAssignedTestsChanged(req.user).catch((err) =>
      logger.error(`broadcastAssignedTestsChanged failed: ${err.message}`)
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export const getMyTests = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const tests = await service.getMyTests({ userId, search: req.query.search || "" });

    // Attach attemptsMade and override status for UI when maxAttempts reached.
    // One batched query for every test in the list instead of two
    // countDocuments() calls per test.
    const TestAttempt = (await import("../../models/testAttempt.model.js")).default;
    const testIds = tests.map((t) => t._id);
    const relevantAttempts = testIds.length
      ? await TestAttempt.find({ testId: { $in: testIds } }).select("testId studentId status").lean()
      : [];

    const statsByTest = new Map();
    for (const attempt of relevantAttempts) {
      const key = String(attempt.testId);
      const stat = statsByTest.get(key) || { attemptsByUser: 0, evaluatedCount: 0 };
      if (String(attempt.studentId) === String(userId)) stat.attemptsByUser += 1;
      if (attempt.status === "EVALUATED") stat.evaluatedCount += 1;
      statsByTest.set(key, stat);
    }

    const enriched = tests.map((t) => {
      const stat = statsByTest.get(String(t._id)) || { attemptsByUser: 0, evaluatedCount: 0 };
      const obj = t.toObject ? t.toObject() : { ...t };
      obj.attemptsMade = stat.attemptsByUser;
      obj.hasResults = stat.evaluatedCount > 0;
      if (Number(obj.maxAttempts || 1) <= stat.attemptsByUser) {
        // For UI purposes mark as completed so no Start button shows
        obj.status = 'COMPLETED';
      }
      return obj;
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error(`getMyTests error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const getAllTests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const tests = req.query.leaderboard === "true"
      ? await service.getLeaderboardTests({
        userId,
        userRole: req.user?.role,
        userOrganizationId: req.user?.role === "ORGANIZATION" ? await resolveOrganizationId(req.user) : null,
      })
      : await service.getAllTests();

    // Attach attemptsMade for each test (current student's perspective).
    // One batched query for the whole list instead of one countDocuments()
    // call per test.
    if (userId) {
      const TestAttempt = (await import("../../models/testAttempt.model.js")).default;
      const testIds = tests.map((t) => t._id);
      const relevantAttempts = testIds.length
        ? await TestAttempt.find({
            testId: { $in: testIds },
            studentId: userId,
            status: { $in: ['SUBMITTED', 'EVALUATED'] },
          }).select("testId").lean()
        : [];

      const attemptsByTest = new Map();
      for (const attempt of relevantAttempts) {
        const key = String(attempt.testId);
        attemptsByTest.set(key, (attemptsByTest.get(key) || 0) + 1);
      }

      const enriched = tests.map((t) => {
        const obj = t.toObject ? t.toObject() : { ...t };
        obj.attemptsMade = attemptsByTest.get(String(t._id)) || 0;
        return obj;
      });
      return res.json({
        success: true,
        data: enriched
      });
    }

    return res.json({
      success: true,
      data: tests
    });
  } catch (err) {
    logger.error(`getAllTests error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

export const getAssignedTests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const search = req.query.search || "";

    let userCreatedAt = null;
    if (userId && req.user?.role === "STUDENT") {
      const User = (await import("../../modules/auth/models/User.model.js")).default;
      const dbUser = await User.findById(userId).select("createdAt");
      if (dbUser) {
        userCreatedAt = dbUser.createdAt;
      }
    }

    const tests = await service.getAssignedTests({ search, userCreatedAt, studentId: userId });

    // Attach current user's attempt count so the UI can hide Start when
    // attempts are exhausted, and link to their latest result if any — one
    // batched query for the whole list instead of two per test.
    const TestAttempt = (await import("../../models/testAttempt.model.js")).default;
    const testIds = tests.map((test) => test.id || test._id);
    const relevantAttempts = userId && testIds.length
      ? await TestAttempt.find({ testId: { $in: testIds }, studentId: userId })
          .select("testId status submittedAt")
          .sort({ submittedAt: -1 })
          .lean()
      : [];

    const attemptsCountByTest = new Map();
    const latestAttemptIdByTest = new Map();
    const latestAttemptStatuses = new Set(['SUBMITTED', 'EVALUATED', 'MISSED']);
    // relevantAttempts is sorted submittedAt desc, so the first entry seen
    // per testId that matches the status filter is the most recent one —
    // same as the original per-test `.findOne().sort({submittedAt:-1})`.
    for (const attempt of relevantAttempts) {
      const key = String(attempt.testId);
      attemptsCountByTest.set(key, (attemptsCountByTest.get(key) || 0) + 1);
      if (!latestAttemptIdByTest.has(key) && latestAttemptStatuses.has(attempt.status)) {
        latestAttemptIdByTest.set(key, attempt._id);
      }
    }

    const enriched = tests.map((test) => {
      const testId = String(test.id || test._id);
      const attemptsMade = attemptsCountByTest.get(testId) || 0;

      // So the UI can link straight to this student's own result (e.g. the
      // "Results" button, or a stale "New Test Assigned" notification click
      // after the test's been completed) instead of a generic list/instructions
      // page that doesn't know which attempt to show.
      const obj = { ...test };
      obj.attemptsMade = attemptsMade;
      obj.latestAttemptId = latestAttemptIdByTest.get(testId) || null;

      if (Number(obj.maxAttempts || 1) <= attemptsMade) {
        obj.status = "COMPLETED";
      }

      return obj;
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error(`getAssignedTests error: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const publishTest = async (req, res, next) => {
  try {
    if (!canManageTest(req.test, req.user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    req.test.isPublished = true;
    req.test.publishedAt = new Date();
    // Derive the real lifecycle status (UPCOMING/ACTIVE/COMPLETED) from
    // isPublished + schedule instead of hardcoding "PUBLISHED" — the literal
    // "PUBLISHED" string doesn't match `getAssignedTests`' filter or the
    // frontend's status-driven UI once a schedule is involved (or once the
    // test is later rescheduled and its status gets recomputed).
    req.test.status = computeTestStatus(req.test);
    await req.test.save();

    const { dispatchNotificationToStudents } = await import("../notification/notification.service.js");
    dispatchNotificationToStudents(req.user, {
      title: "New Test Assigned",
      message: `You have been assigned a new test: "${req.test.title}". Complete it before the deadline.`,
      type: "TEST_ASSIGNED",
      link: `/student/dashboard/tests/${req.test._id}/instructions`,
      metadata: { testId: req.test._id }
    }).catch(err => logger.error(`Notification dispatch failed: ${err.message}`));

    res.json({ success: true, data: req.test });
  } catch (e) {
    next(e);
  }
};

export const acceptTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
    const assignment = await TestAssignment.findOneAndUpdate(
      { testId, studentId },
      { status: "ACCEPTED", acceptedAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const declineTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
    const assignment = await TestAssignment.findOneAndUpdate(
      { testId, studentId },
      { status: "DECLINED", declinedAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const pendingTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
    const assignment = await TestAssignment.findOneAndUpdate(
      { testId, studentId },
      { status: "PENDING" },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const hideTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
    const assignment = await TestAssignment.findOneAndUpdate(
      { testId, studentId },
      { status: "HIDDEN", hiddenAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};

export const startTestAssignment = async (req, res, next) => {
  try {
    const studentId = req.user?._id || req.user?.id;
    const testId = req.params.id;

    const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
    const assignment = await TestAssignment.findOne({ testId, studentId });

    if (!assignment || !assignment.acceptedAt || assignment.status === "DECLINED") {
      return res.status(400).json({
        success: false,
        message: "You must accept the test assignment before starting the test"
      });
    }

    assignment.status = "STARTED";
    assignment.startedAt = new Date();
    await assignment.save();

    res.json({ success: true, data: assignment });
  } catch (e) {
    next(e);
  }
};