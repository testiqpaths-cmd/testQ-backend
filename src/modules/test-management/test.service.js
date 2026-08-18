import crypto from "crypto";
import Test from "../../models/test.model.js";
import TestSeries from "../../models/testSeries.model.js";
import TestAssignment from "../../models/testAssignment.model.js";
import { computeTestStatus } from "./utils/status.js";
import { ensureCreatorOrgIncluded, resolveAllowedStudents, resolveMandatoryOrgTestIds } from "./utils/visibility.js";
import UserModel from "../../models/user.model.js";
import { dispatchNotificationToStudents } from "../notification/notification.service.js";

const creatorRoleFilter = ["IQPATH_ADMIN", "ORGANIZATION"];

const leaderboardCreatorFields = [
  { $ifNull: ["$creatorUser.firstName", ""] },
  " ",
  { $ifNull: ["$creatorUser.lastName", ""] },
];

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
    allowedStudents: await resolveAllowedStudents(data.visibility, data.allowedStudents, user),
    createdBy: { userId: user._id || user.id, role: user.role },
  };

  await ensureCreatorOrgIncluded(payload);
  const test = await Test.create(payload);

  // Students create tests only for themselves to practice on — there's no
  // review/schedule workflow for them, so their tests go live immediately
  // instead of sitting in an un-startable DRAFT state. IQ Room tests get the
  // same treatment regardless of creator role: they're only ever reachable
  // via a room code + the room's own WAITING/RUNNING state (never listed
  // among a student's assigned tests — see the isIQRoomTest filter in
  // getAssignedTests), so there's no discovery risk in publishing
  // immediately, and forcing a host to go find the underlying test and
  // manually publish it before the room they just "started" actually works
  // defeats the point of a live, spin-up-and-go contest.
  if (user.role === "STUDENT" || test.isIQRoomTest) {
    test.isPublished = true;
    test.publishedAt = new Date();
    test.status = computeTestStatus(test);
  } else {
    test.status = "DRAFT";
    test.isPublished = false;
  }
  await test.save();

  return test;
}

export async function updateTest(test, payload, user) {
  if (payload.visibility !== undefined || payload.allowedStudents !== undefined) {
    const nextVisibility = payload.visibility ?? test.visibility;
    payload.allowedStudents = await resolveAllowedStudents(
      nextVisibility,
      payload.allowedStudents ?? test.allowedStudents,
      user
    );
  }

  Object.assign(test, payload);
  await ensureCreatorOrgIncluded(test);

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

  await test.save();

  return test;
}

export async function deleteTest(test) {
  test.isDeleted = 1;
  await test.save();
}

export const getAllTests = async () => {
  // Exclude tests that belong to a series or IQ Room. Read-only list view —
  // the controller already handles either a Mongoose doc or a plain object
  // (`t.toObject ? t.toObject() : {...t}`), so .lean() is a safe, free win.
  return await Test.find({ isSeriesTest: { $ne: true }, isIQRoomTest: { $ne: true } })
    .sort({ createdAt: -1 })
    .lean();
};

export const getLeaderboardTests = async ({ userId = null, userRole = null, userOrganizationId = null } = {}) => {
  const tests = await Test.aggregate([
    {
      $match: {
        isSeriesTest: { $ne: true },
        isIQRoomTest: { $ne: true },
        isDeleted: { $ne: 1 },
        // A test with no attempts can't have a leaderboard yet — only show
        // tests that are actually published (previously any DRAFT test the
        // creator started but never published still showed up here).
        isPublished: true,
        "createdBy.role": { $in: creatorRoleFilter },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy.userId",
        foreignField: "_id",
        as: "creatorUser",
      },
    },
    {
      $unwind: {
        path: "$creatorUser",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "organizations",
        localField: "creatorUser.organizationId",
        foreignField: "_id",
        as: "creatorOrganization",
      },
    },
    {
      $unwind: {
        path: "$creatorOrganization",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        creatorName: {
          $trim: {
            input: { $concat: leaderboardCreatorFields },
          },
        },
        creatorEmail: "$creatorUser.email",
        creatorOrganizationName: "$creatorOrganization.name",
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  // `status` is only ever (re)computed when a test is created/updated/published —
  // nothing recomputes it as real time passes, so a FIXED-schedule test whose
  // window already ended stays frozen at whatever it was last written as (often
  // "UPCOMING" forever). Recompute it live here instead of trusting the stale
  // stored value.
  const withLiveStatus = tests.map((test) => ({
    ...test,
    status: computeTestStatus(test),
  }));

  // A student should only be offered a leaderboard for a test they actually
  // accepted — otherwise every published admin/org test shows up as a
  // selectable leaderboard source regardless of whether this student was ever
  // assigned it or chose to accept it. Admins/orgs browsing this same list to
  // review their own tests' leaderboards are unaffected.
  if (userRole === "STUDENT" && userId) {
    const assignments = await TestAssignment.find({
      studentId: userId,
      testId: { $in: withLiveStatus.map((t) => t._id) },
    })
      .select("testId acceptedAt status")
      .lean();

    const acceptedTestIds = new Set(
      assignments
        .filter((a) => a.acceptedAt && a.status !== "DECLINED")
        .map((a) => String(a.testId))
    );

    return withLiveStatus.filter((t) => acceptedTestIds.has(String(t._id)));
  }

  // An organization should only see its own tests' leaderboards, plus any
  // admin-created test that specifically targeted this org (ORG_ONLY +
  // allowedOrganizations includes them) — NOT every other org's tests, and
  // NOT an admin's PUBLIC test just because this org's students happen to be
  // able to take it.
  if (userRole === "ORGANIZATION") {
    const orgId = userOrganizationId ? String(userOrganizationId) : null;
    if (!orgId) return [];

    return withLiveStatus.filter((t) => {
      const creatorOrgId = t.creatorUser?.organizationId ? String(t.creatorUser.organizationId) : null;
      const isOwnTest = creatorOrgId === orgId;
      const isAdminTestTargetingUs =
        t.createdBy?.role === "IQPATH_ADMIN" &&
        t.visibility === "ORG_ONLY" &&
        Array.isArray(t.allowedOrganizations) &&
        t.allowedOrganizations.some((id) => String(id) === orgId);

      return isOwnTest || isAdminTestTargetingUs;
    });
  }

  return withLiveStatus;
};

export const getMyTests = async ({ userId, search = "" }) => {
  const filters = {
    "createdBy.userId": userId,
    isDeleted: { $ne: 1 },
  };

  if (String(search || "").trim()) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  // Exclude series and IQ Room tests from normal user's test listings
  filters.isSeriesTest = { $ne: true };
  filters.isIQRoomTest = { $ne: true };

  // Read-only list view — same defensive controller handling as getAllTests.
  return Test.find(filters)
    .populate("subjectId", "name")
    .sort({ createdAt: -1 })
    .lean();
};

// Per-test stats for the creator (org/admin): who's registered (accepted the
// assignment or further), who's completed it, who hasn't, and — for anyone
// who has — their result.
export const getTestStats = async (testId) => {
  const TestAssignment = (await import("../../models/testAssignment.model.js")).default;
  const TestAttempt = (await import("../../models/testAttempt.model.js")).default;
  const User = (await import("../auth/models/User.model.js")).default;

  const assignments = await TestAssignment.find({ testId }).lean();

  const studentIds = assignments.map((a) => a.studentId);
  const students = studentIds.length
    ? await User.find({ _id: { $in: studentIds } }).select("firstName lastName email").lean()
    : [];
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  // A student can retake a test (maxAttempts > 1) — keep only their most
  // recent submitted/evaluated attempt, same "sort desc, take first per
  // student" pattern used in getAssignedTests.
  const attempts = await TestAttempt.find({
    testId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  })
    .select("studentId totalScore maxScore percentage resultStatus submittedAt")
    .sort({ submittedAt: -1 })
    .lean();

  const latestAttemptByStudent = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.studentId);
    if (!latestAttemptByStudent.has(key)) latestAttemptByStudent.set(key, attempt);
  }

  const registeredStatuses = new Set(["ACCEPTED", "STARTED", "SUBMITTED"]);
  const byStatus = { PENDING: 0, ACCEPTED: 0, DECLINED: 0, STARTED: 0, SUBMITTED: 0, MISSED: 0, HIDDEN: 0 };

  const studentRows = assignments.map((assignment) => {
    const studentId = String(assignment.studentId);
    const student = studentMap.get(studentId);
    const attempt = latestAttemptByStudent.get(studentId);

    if (byStatus[assignment.status] !== undefined) byStatus[assignment.status] += 1;

    return {
      studentId,
      name: student ? `${student.firstName || ""} ${student.lastName || ""}`.trim() || "Unknown" : "Unknown",
      email: student?.email || null,
      assignmentStatus: assignment.status,
      acceptedAt: assignment.acceptedAt || null,
      submittedAt: assignment.submittedAt || null,
      result: attempt
        ? {
            attemptId: attempt._id,
            totalScore: attempt.totalScore,
            maxScore: attempt.maxScore,
            percentage: attempt.percentage,
            resultStatus: attempt.resultStatus,
          }
        : null,
    };
  });

  const registered = assignments.filter((a) => registeredStatuses.has(a.status)).length;
  const completed = byStatus.SUBMITTED;

  return {
    summary: {
      totalAssigned: assignments.length,
      registered,
      completed,
      notCompleted: registered - completed,
      byStatus,
    },
    students: studentRows,
  };
};

export const getAssignedTests = async ({ search = "", userCreatedAt = null, studentId = null, userRole = null } = {}) => {
  // `isPublished` is the canonical "is this live" flag (see computeTestStatus,
  // which every publish/update path derives `status` from). Matching on the
  // literal string "PUBLISHED" instead used to exclude every series test
  // (whose status is always UPCOMING/ACTIVE/COMPLETED/DRAFT, never that exact
  // string) and any standalone test that had been rescheduled since being
  // published (which recomputes status away from "PUBLISHED" too).
  const filters = {
    isPublished: true,
    isDeleted: { $ne: 1 },
    isIQRoomTest: { $ne: true },
  };

  if (userCreatedAt) {
    filters.createdAt = { $gte: new Date(userCreatedAt) };
  }

  // Combined into $and (rather than two competing top-level $or keys) since
  // both the search condition and the SELECT_STUDENT gate below need their
  // own $or.
  const andConditions = [];

  if (String(search || "").trim()) {
    andConditions.push({
      $or: [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ],
    });
  }

  // A SELECT_STUDENT test is only visible to the specific students its
  // creator chose — everyone else must not see it here at all, the same way
  // it's excluded from a direct single-test fetch (visibility.middleware.js).
  // IQPATH_ADMIN keeps universal access, matching that same precedent.
  if (studentId && userRole !== "IQPATH_ADMIN") {
    andConditions.push({
      $or: [
        { visibility: { $ne: "SELECT_STUDENT" } },
        { allowedStudents: studentId },
      ],
    });
  }

  if (andConditions.length) {
    filters.$and = andConditions;
  }

  // Read-only list view; .lean() below means `test` is already a plain
  // object, so the two spreads further down use `...test` directly instead
  // of `...test.toObject()` (which would throw on a lean result).
  const tests = await Test.find(filters)
    .populate("subjectId", "name")
    .populate({
      path: "testSeriesId",
      select: "title description visibility createdAt plannedTestCount",
    })
    .sort({ createdAt: -1 })
    .lean();

  if (studentId) {
    const assignments = await TestAssignment.find({
      studentId,
      testId: { $in: tests.map((t) => t._id) },
    }).lean();

    const assignmentMap = new Map(
      assignments.map((a) => [String(a.testId), a])
    );

    // Org students can't opt out of their own organization's tests — auto-
    // accept them (self-healing: once a test's assignment is ACCEPTED here,
    // later fetches find that record and skip the write below) rather than
    // special-casing "mandatory" in every place that reads TestAssignment
    // (start-attempt gate, decline endpoint, etc). A real ACCEPTED record
    // means those gates need no changes at all. Also upgrades a PENDING/
    // DECLINED/HIDDEN assignment recorded before this test became mandatory
    // (e.g. the org enrolled the student after they'd already declined) —
    // only STARTED/SUBMITTED/MISSED are left alone, since those reflect an
    // attempt that already happened.
    const student = await UserModel.findById(studentId).select("organizationId").lean();
    const mandatoryTestIds = await resolveMandatoryOrgTestIds(tests, student?.organizationId);
    const needsAutoAccept = [...mandatoryTestIds].filter((id) => {
      const existing = assignmentMap.get(id);
      return !existing || ["PENDING", "DECLINED", "HIDDEN"].includes(existing.status);
    });

    if (needsAutoAccept.length) {
      const acceptedAt = new Date();
      await TestAssignment.bulkWrite(
        needsAutoAccept.map((testId) => ({
          updateOne: {
            filter: { testId, studentId },
            update: { $set: { status: "ACCEPTED", acceptedAt } },
            upsert: true,
          },
        }))
      );
      needsAutoAccept.forEach((testId) => {
        assignmentMap.set(testId, { status: "ACCEPTED", acceptedAt });
      });
    }

    // A series test's own visibility on this list is gated by whether the
    // STUDENT accepted the series as a whole, not by its individual
    // TestAssignment — accepting a series bulk-accepts every test in it
    // (see testSeries.controller.js's acceptSeriesAssignment), so
    // assignmentStatus alone would otherwise never reflect "not yet decided".
    const seriesIds = [
      ...new Set(
        tests
          .map((t) => t.testSeriesId?._id || t.testSeriesId)
          .filter(Boolean)
          .map(String)
      ),
    ];
    let seriesAssignmentMap = new Map();
    if (seriesIds.length) {
      const TestSeriesAssignment = (await import("../../models/testSeriesAssignment.model.js")).default;
      const seriesAssignments = await TestSeriesAssignment.find({
        studentId,
        seriesId: { $in: seriesIds },
      }).lean();
      seriesAssignmentMap = new Map(
        seriesAssignments.map((a) => [String(a.seriesId), a])
      );
    }

    return tests
      .map((test) => {
        const assignment = assignmentMap.get(String(test._id));
        const seriesId = test.testSeriesId?._id || test.testSeriesId || null;
        const seriesAssignment = seriesId ? seriesAssignmentMap.get(String(seriesId)) : null;
        return {
          ...test,
          id: String(test._id),
          assignmentStatus: assignment ? assignment.status : "PENDING",
          seriesAssignmentStatus: seriesId ? (seriesAssignment ? seriesAssignment.status : "PENDING") : null,
        };
      })
      // A declined test/series shouldn't keep sitting on the assigned-tests
      // list looking exactly like a still-undecided one — only PENDING and
      // ACCEPTED (plus whatever attempt-lifecycle statuses follow ACCEPTED,
      // e.g. STARTED/SUBMITTED/MISSED) belong here.
      .filter((test) => test.assignmentStatus !== "HIDDEN" && test.assignmentStatus !== "DECLINED")
      .filter((test) => test.seriesAssignmentStatus !== "HIDDEN" && test.seriesAssignmentStatus !== "DECLINED");
  }

  return tests.map((test) => ({
    ...test,
    id: String(test._id),
    assignmentStatus: "PENDING",
    seriesAssignmentStatus: (test.testSeriesId?._id || test.testSeriesId) ? "PENDING" : null,
  }));
};
