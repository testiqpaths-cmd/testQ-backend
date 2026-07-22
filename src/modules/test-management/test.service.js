import crypto from "crypto";
import logger from "../../config/logger.js";
import { computeTestStatus } from "./utils/status.js";
import { dispatchNotificationToStudents } from "../notification/notification.service.js";
import {
  createTestRepo,
  saveTestRepo,
  findAllStandaloneTestsRepo,
  aggregateLeaderboardTestsRepo,
  getMyTestsRepo,
  getAssignedTestsRepo,
  getUserCreatedAtByIdRepo,
} from "./repositories/test.repository.js";
import {
  upsertAssignmentStatusRepo,
  getAssignmentByTestAndStudentRepo,
  saveAssignmentRepo,
  getAssignmentsForTestsRepo,
} from "./repositories/testAssignment.repository.js";
import {
  countAttemptsByTestAndStudentRepo,
  countEvaluatedAttemptsByTestRepo,
  countCompletedAttemptsByTestAndStudentRepo,
} from "../test-attempts/repositories/testAttempt.repository.js";

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

  const test = await createTestRepo(payload);

  // Students create tests only for themselves to practice on — there's no
  // review/schedule workflow for them, so their tests go live immediately
  // instead of sitting in an un-startable DRAFT state.
  if (user.role === "STUDENT") {
    test.isPublished = true;
    test.publishedAt = new Date();
    test.status = computeTestStatus(test);
  } else {
    test.status = "DRAFT";
    test.isPublished = false;
  }
  await saveTestRepo(test);

  return test;
}

export async function updateTest(test, payload, user) {
  Object.assign(test, payload);

  const hasFixedSchedule = Boolean(test.startTime && test.endTime);
  if (hasFixedSchedule) {
    test.scheduleType = "FIXED";
  }

  // Always derive status fresh from isPublished + schedule. computeTestStatus
  // already returns "DRAFT" whenever isPublished is false, so a draft test
  // edited without an explicit isPublished:true stays DRAFT; an explicit
  // publish (isPublished: true) or a reschedule of an already-published test
  // both get the correct UPCOMING/ACTIVE/COMPLETED status. The previous
  // prevStatus-based guard here reverted isPublished/status back to DRAFT
  // whenever the payload didn't also include a literal status: "PUBLISHED"
  // field, silently undoing publish attempts that only sent isPublished: true.
  test.status = computeTestStatus(test);

  await saveTestRepo(test);

  return test;
}

export async function deleteTest(test) {
  test.isDeleted = 1;
  await saveTestRepo(test);
}

export const getAllTests = async ({ leaderboard = false, userId = null } = {}) => {
  const tests = leaderboard
    ? await aggregateLeaderboardTestsRepo()
    : await findAllStandaloneTestsRepo();

  if (!userId) {
    return tests;
  }

  return Promise.all(
    tests.map(async (t) => {
      const attemptsMade = await countCompletedAttemptsByTestAndStudentRepo(t._id, userId);
      const obj = t.toObject ? t.toObject() : { ...t };
      obj.attemptsMade = attemptsMade;
      return obj;
    })
  );
};

export const getMyTests = async ({ userId, search = "" }) => {
  const tests = await getMyTestsRepo({ userId, search });

  return Promise.all(
    tests.map(async (t) => {
      const attemptsMade = await countAttemptsByTestAndStudentRepo(t._id, userId);
      const evaluatedCount = await countEvaluatedAttemptsByTestRepo(t._id);
      const obj = t.toObject ? t.toObject() : { ...t };
      obj.attemptsMade = attemptsMade;
      obj.hasResults = evaluatedCount > 0;
      if (Number(obj.maxAttempts || 1) <= attemptsMade) {
        // For UI purposes mark as completed so no Start button shows
        obj.status = "COMPLETED";
      }
      return obj;
    })
  );
};

export const getAssignedTests = async ({ search = "", userId = null, userRole = null, studentId = null } = {}) => {
  let userCreatedAt = null;
  if (userId && userRole === "STUDENT") {
    const dbUser = await getUserCreatedAtByIdRepo(userId);
    if (dbUser) {
      userCreatedAt = dbUser.createdAt;
    }
  }

  const tests = await getAssignedTestsRepo({ search, userCreatedAt });

  let mapped;
  if (studentId) {
    const assignments = await getAssignmentsForTestsRepo(studentId, tests.map((t) => t._id));
    const assignmentMap = new Map(
      assignments.map((a) => [String(a.testId), a])
    );

    mapped = tests
      .map((test) => {
        const assignment = assignmentMap.get(String(test._id));
        return {
          ...test.toObject(),
          id: String(test._id),
          assignmentStatus: assignment ? assignment.status : "PENDING",
        };
      })
      .filter((test) => test.assignmentStatus !== "HIDDEN");
  } else {
    mapped = tests.map((test) => ({
      ...test.toObject(),
      id: String(test._id),
      assignmentStatus: "PENDING",
    }));
  }

  // Attach current user's attempt count so the UI can hide Start when attempts are exhausted.
  return Promise.all(
    mapped.map(async (test) => {
      const attemptsMade = studentId
        ? await countAttemptsByTestAndStudentRepo(test.id || test._id, studentId)
        : 0;

      const obj = { ...test };
      obj.attemptsMade = attemptsMade;

      if (Number(obj.maxAttempts || 1) <= attemptsMade) {
        obj.status = "COMPLETED";
      }

      return obj;
    })
  );
};

export const getTestForViewerService = async (test, user) => {
  if (user?.role === "STUDENT") {
    const dbUser = await getUserCreatedAtByIdRepo(user._id || user.id);
    if (dbUser && test?.createdAt && new Date(test.createdAt) < new Date(dbUser.createdAt)) {
      return {
        error: "You cannot access a test created before your registration date",
        status: 403,
      };
    }
  }
  return { test };
};

export const publishTestService = async (test, user) => {
  test.isPublished = true;
  test.publishedAt = new Date();
  // Derive the real lifecycle status (UPCOMING/ACTIVE/COMPLETED) from
  // isPublished + schedule instead of hardcoding "PUBLISHED" — the literal
  // "PUBLISHED" string doesn't match `getAssignedTests`' filter or the
  // frontend's status-driven UI once a schedule is involved (or once the
  // test is later rescheduled and its status gets recomputed).
  test.status = computeTestStatus(test);
  await saveTestRepo(test);

  dispatchNotificationToStudents(user, {
    title: "New Test Assigned",
    message: `You have been assigned a new test: "${test.title}". Complete it before the deadline.`,
    type: "TEST_ASSIGNED",
    link: `/student/dashboard/tests/${test._id}/instructions`,
    metadata: { testId: test._id },
  }).catch((err) => logger.error(`Notification dispatch failed: ${err.message}`));

  return test;
};

export const acceptTestAssignmentService = (testId, studentId) =>
  upsertAssignmentStatusRepo(testId, studentId, {
    status: "ACCEPTED",
    acceptedAt: new Date(),
  });

export const declineTestAssignmentService = (testId, studentId) =>
  upsertAssignmentStatusRepo(testId, studentId, {
    status: "DECLINED",
    declinedAt: new Date(),
  });

export const pendingTestAssignmentService = (testId, studentId) =>
  upsertAssignmentStatusRepo(testId, studentId, { status: "PENDING" });

export const hideTestAssignmentService = (testId, studentId) =>
  upsertAssignmentStatusRepo(testId, studentId, {
    status: "HIDDEN",
    hiddenAt: new Date(),
  });

export const startTestAssignmentService = async (testId, studentId) => {
  const assignment = await getAssignmentByTestAndStudentRepo(testId, studentId);

  if (!assignment || !assignment.acceptedAt || assignment.status === "DECLINED") {
    return {
      error: "You must accept the test assignment before starting the test",
      status: 400,
    };
  }

  assignment.status = "STARTED";
  assignment.startedAt = new Date();
  await saveAssignmentRepo(assignment);

  return { assignment };
};
