import mongoose from "mongoose";
import { computeAttemptTiming } from "../utils/attemptTimer.util.js";
import { saveAnswerSchema } from "../schemas/saveAnswer.schema.js";
import { selectAttemptQuestions } from "./questionSelection.service.js";
import { evaluateObjectiveForAttempt } from "./evaluateObjectiveAttempts.service.js";
import { getIO } from "../../../sockets/index.js";
import {
  createAttemptRepo,
  findInProgressAttemptByFilterRepo,
  countCompletedAttemptsRepo,
  saveAttemptRepo,
  getAttemptEvaluationSnapshotRepo,
} from "../repositories/testAttempt.repository.js";
import { getIQRoomByIdLeanRepo, getIQRoomByIdRepo } from "../repositories/iqRoom.repository.js";
import { getUserCreatedAtByIdRepo } from "../repositories/user.repository.js";
import {
  getTestByIdLeanRepo,
  getTestSummaryForAttemptRepo,
  getTestTitleAndEvalTypeRepo,
} from "../../test-management/repositories/test.repository.js";
import {
  getAssignmentByTestAndStudentRepo,
  markAssignmentStartedFromAttemptRepo,
} from "../../test-management/repositories/testAssignment.repository.js";

const canStartTest = (test, user) => {
  if (!test || !user) return false;

  if (test.visibility === "PUBLIC") return true;
  if (test.visibility === "LINK_ONLY") return true;

  if (test.visibility === "ORG_ONLY") {
    const userOrganizationId = String(user.organizationId || "");
    if (!userOrganizationId) return false;

    const allowedOrganizations = Array.isArray(test.allowedOrganizations)
      ? test.allowedOrganizations.map((id) => String(id))
      : [];

    return allowedOrganizations.length === 0 || allowedOrganizations.includes(userOrganizationId);
  }

  return false;
};

export const startTestAttemptService = async ({ testId, studentId, iqRoomId, user }) => {
  if (!mongoose.Types.ObjectId.isValid(testId)) {
    return { success: false, status: 400, message: "Invalid testId" };
  }

  // 1) Load test
  const test = await getTestByIdLeanRepo(testId);
  if (!test) {
    return { success: false, status: 404, message: "Test not found" };
  }

  // 2) Validate visibility and organization access
  if (!canStartTest(test, user)) {
    return {
      success: false,
      status: 403,
      message: "You are not allowed to start this test",
    };
  }

  if (user?.role === "STUDENT") {
    const dbUser = await getUserCreatedAtByIdRepo(studentId);
    if (dbUser && test.createdAt && new Date(test.createdAt) < new Date(dbUser.createdAt)) {
      return {
        success: false,
        status: 403,
        message: "You cannot start a test created before your registration date",
      };
    }
  }

  if (test.scheduleType === "IMMEDIATE" && !test.isPublished) {
    return { success: false, status: 403, message: "This test is not published yet" };
  }

  // 3) Validate schedule (adapt to your test fields)
  // Example fields: test.startTime, test.endTime (Date)
  if (!iqRoomId) {
    const now = new Date();
    if (test.startTime && now < new Date(test.startTime)) {
      return { success: false, status: 400, message: "Test has not started yet" };
    }
    if (test.endTime && now > new Date(test.endTime)) {
      return { success: false, status: 400, message: "Test has already ended" };
    }
  }

  // Verify assignment is accepted for student. Acceptance only needs to happen
  // once per test — `acceptedAt` is the persistent record of that, unlike
  // `status`, which also tracks per-attempt lifecycle (STARTED/SUBMITTED) and
  // gets overwritten after every attempt, so it can't be used as the gate here.
  if (user?.role === "STUDENT" && !iqRoomId) {
    const assignment = await getAssignmentByTestAndStudentRepo(testId, studentId);
    if (!assignment || !assignment.acceptedAt || assignment.status === "DECLINED") {
      return {
        success: false,
        status: 400,
        message: "You must accept the test assignment before starting the test",
      };
    }
  }

  // 4) Prevent multiple in-progress attempts and enforce maxAttempts
  const baseQuery = { testId, studentId };
  if (iqRoomId) {
    baseQuery.iqRoomId = iqRoomId;
  } else {
    baseQuery.$or = [{ iqRoomId: null }, { iqRoomId: { $exists: false } }];
  }

  // Check if there is an in-progress attempt for this specific context
  const existingInProgress = await findInProgressAttemptByFilterRepo(baseQuery);
  if (existingInProgress) {
    const existingTiming = computeAttemptTiming(existingInProgress);
    return {
      success: false,
      status: 409,
      message: 'Attempt already exists for this test',
      data: {
        attemptId: existingInProgress._id,
        status: existingInProgress.status,
        startedAt: existingInProgress.startedAt,
        endsAt: existingInProgress.endsAt,
        duration: existingInProgress.duration,
        maxScore: existingInProgress.maxScore,
        timing: existingTiming,
      },
    };
  }

  // Count completed/submitted attempts to enforce maxAttempts
  const completedAttemptsCount = await countCompletedAttemptsRepo(baseQuery);

  if (iqRoomId) {
    // IQ Room attempts are strictly 1 per user per room
    if (completedAttemptsCount >= 1) {
      return {
        success: false,
        status: 403,
        message: 'You have already completed this live contest',
      };
    }
  } else {
    // Normal test attempts follow the test.maxAttempts rule
    const allowedAttempts = Number(test.maxAttempts) || 1;
    if (completedAttemptsCount >= allowedAttempts) {
      return {
        success: false,
        status: 403,
        message: 'Maximum attempts reached for this test',
      };
    }
  }

  const { questionSnapshots, questions } = await selectAttemptQuestions(test);

  if (!questionSnapshots.length) {
    return {
      success: false,
      status: 400,
      message: "No eligible questions were found for this test",
    };
  }

  // 5) Copy duration & marks server-side
  let duration = Number(test.duration); // minutes (recommended)
  const maxScore = Number(test.totalMarks);

  if (!Number.isFinite(duration) || duration <= 0) {
    return { success: false, status: 500, message: "Test duration is invalid on server" };
  }
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return { success: false, status: 500, message: "Test totalMarks is invalid on server" };
  }

  const startedAt = new Date();
  let endsAt = new Date(startedAt.getTime() + duration * 60 * 1000);

  let endTime = test.endTime;
  if (iqRoomId) {
    const room = await getIQRoomByIdLeanRepo(iqRoomId);
    if (room && room.endTime) {
      endTime = room.endTime;
    }
  }

  if (endTime) {
    const endTimeDate = new Date(endTime);
    const diffMs = endTimeDate.getTime() - startedAt.getTime();
    const diffMinutes = diffMs / (60 * 1000);
    if (diffMinutes < duration) {
      duration = Math.max(0, diffMinutes);
      endsAt = endTimeDate;
    }
  }

  // 6) Create attempt
  let attempt;
  try {
    attempt = await createAttemptRepo({
      testId,
      studentId,
      iqRoomId: iqRoomId || null,
      startedAt,
      endsAt,
      duration,
      maxScore,
      questionSnapshots,
      status: "IN_PROGRESS",
      answers: [],
    });
  } catch (err) {
    // Handle unique index error (one attempt per student per test)
    if (err?.code === 11000) {
      const existingAttempt = await findInProgressAttemptByFilterRepo({ testId, studentId });
      return {
        success: false,
        status: 409,
        message: "Attempt already exists for this test",
        data: existingAttempt
          ? {
              attemptId: existingAttempt._id,
              status: existingAttempt.status,
              startedAt: existingAttempt.startedAt,
              endsAt: existingAttempt.endsAt,
              duration: existingAttempt.duration,
              maxScore: existingAttempt.maxScore,
            }
          : undefined,
      };
    }
    throw err;
  }

  if (!iqRoomId && user?.role === "STUDENT") {
    await markAssignmentStartedFromAttemptRepo(testId, studentId, startedAt);
  }

  const timing = computeAttemptTiming(attempt);

  return {
    success: true,
    data: {
      attemptId: attempt._id,
      testId: attempt.testId,
      studentId: attempt.studentId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      endsAt: attempt.endsAt,
      duration: attempt.duration,
      maxScore: attempt.maxScore,
      questions,
      timing, // ✅ backend remaining time
    },
  };
};

export const getAttemptTestSummaryService = (testId) => getTestSummaryForAttemptRepo(testId);

export const saveAnswerService = async (attempt, timing, body) => {
  // ✅ Block if not in progress (Acceptance Criteria)
  if (attempt.status !== "IN_PROGRESS") {
    return { error: "Attempt is not in progress", status: 409 };
  }

  // ✅ If timer says expired, block (your middleware may auto-expire already)
  if (timing?.expired) {
    return { error: "Time expired. Attempt ended.", status: 409 };
  }

  // ✅ Validate request body
  const parsed = saveAnswerSchema.parse(body);
  const questionId = new mongoose.Types.ObjectId(parsed.questionId);
  const timeSpentMs = Number(parsed.timeSpentMs || 0);

  const snapshotIndex = Array.isArray(attempt.questionSnapshots)
    ? attempt.questionSnapshots.findIndex(
        (item) => item.questionId.toString() === questionId.toString(),
      )
    : -1;

  if (snapshotIndex === -1) {
    return { error: "Question is not part of this attempt", status: 404 };
  }

  const snapshot = attempt.questionSnapshots[snapshotIndex];
  if (Number.isFinite(timeSpentMs) && timeSpentMs > 0) {
    snapshot.timeSpentMs = (snapshot.timeSpentMs || 0) + timeSpentMs;
    snapshot.lastViewedAt = new Date();
    if (!snapshot.startedAt) {
      snapshot.startedAt = snapshot.lastViewedAt;
    }
  }

  // ✅ Upsert by questionId (no duplicates)
  const idx = attempt.answers.findIndex(
    (a) => a.questionId.toString() === questionId.toString(),
  );

  const updatedAnswer = {
    questionId,
    selectedOption: parsed.selectedOption ?? null,
    textAnswer: parsed.textAnswer ?? null,
    answeredAt: new Date(),
    timeSpentMs: Number.isFinite(timeSpentMs) ? timeSpentMs : 0,
  };

  if (parsed.selectedOption !== undefined || parsed.textAnswer !== undefined) {
    updatedAnswer.timeSpentMs = snapshot.timeSpentMs || updatedAnswer.timeSpentMs;

    if (idx >= 0) {
      // update existing entry
      attempt.answers[idx].selectedOption = updatedAnswer.selectedOption;
      attempt.answers[idx].textAnswer = updatedAnswer.textAnswer;
      attempt.answers[idx].answeredAt = updatedAnswer.answeredAt;
      attempt.answers[idx].timeSpentMs = updatedAnswer.timeSpentMs;
    } else {
      // add new entry
      attempt.answers.push(updatedAnswer);
    }
  } else if (idx >= 0) {
    attempt.answers[idx].timeSpentMs = snapshot.timeSpentMs || attempt.answers[idx].timeSpentMs || 0;
  }

  await saveAttemptRepo(attempt);

  return {
    questionId: parsed.questionId,
    timeSpentMs: snapshot.timeSpentMs || 0,
  };
};

export const submitAttemptService = async (attempt, timing, body) => {
  // Prevent submission if not in progress and not already expired
  if (attempt.status !== "IN_PROGRESS" && attempt.status !== "EXPIRED") {
    return {
      success: false,
      status: 409,
      message: `Cannot submit attempt - status is ${attempt.status.toLowerCase()}`,
      data: {
        status: attempt.status,
        submittedAt: attempt.submittedAt,
        timing: {
          remainingSeconds: timing.remainingSeconds,
          remainingMs: timing.remainingMs,
          expired: timing.expired,
          serverNow: timing.serverNow,
        },
      },
    };
  }

  // ✅ Manually submit before time expires, unless it already expired
  if (attempt.status !== "EXPIRED") {
    attempt.status = "SUBMITTED";
    attempt.submittedAt = new Date();
    const cheatingReasons = ["CHEATING", "PROLONGED_ABSENCE", "PHONE_PERSISTENCE", "PHONE_DETECTED", "FACE_ABSENT"];
    if (cheatingReasons.includes(body.expireReason)) {
      attempt.expireReason = "CHEATING";
    } else if (body.expireReason === "TIME_EXPIRED") {
      attempt.expireReason = "TIME_EXPIRED";
    } else {
      attempt.expireReason = "MANUAL_SUBMIT";
    }
    await saveAttemptRepo(attempt);
  }

  const evaluatedAttempt = await evaluateObjectiveForAttempt(attempt._id);

  // ✅ If part of an IQ Room, notify the room
  if (attempt.iqRoomId) {
    try {
      const room = await getIQRoomByIdRepo(attempt.iqRoomId);
      if (room) {
        const io = getIO();
        io.of("/iq-room").to(room.roomCode).emit("leaderboard-update", {
          userId: attempt.studentId,
          attemptId: attempt._id,
        });
      }
    } catch (err) {
      console.error("Failed to emit socket update for IQ Room:", err);
    }
  }

  return {
    success: true,
    data: {
      attemptId: attempt._id.toString(),
      testId: attempt.testId,
      resultId: attempt._id.toString(), // ✅ attemptId IS the result
      status: evaluatedAttempt?.status || "SUBMITTED",
      submittedAt: evaluatedAttempt?.submittedAt || attempt.submittedAt,
      totalScore: evaluatedAttempt?.totalScore ?? 0,
      percentage: evaluatedAttempt?.percentage ?? 0,
      timing: {
        remainingSeconds: Math.max(0, timing.remainingSeconds),
        remainingMs: Math.max(0, timing.remainingMs),
        expired: false,
        serverNow: timing.serverNow,
      },
    },
  };
};

export const getEvaluationStatusService = async (attemptId) => {
  if (!mongoose.Types.ObjectId.isValid(attemptId)) {
    return { error: "Invalid attemptId", status: 400 };
  }

  const attempt = await getAttemptEvaluationSnapshotRepo(attemptId);

  if (!attempt) {
    return { error: "Attempt not found", status: 404 };
  }

  const test = await getTestTitleAndEvalTypeRepo(attempt.testId);

  // Determine evaluation type: auto (all MCQ), manual (has subjective), hybrid (mixed)
  const hasSubjective = Array.isArray(attempt.questionSnapshots) &&
    attempt.questionSnapshots.some(q => q.type === "SUBJECTIVE" || q.type === "SHORT_ANSWER");

  const evaluationType = hasSubjective ? "hybrid" : "auto";
  const evaluationStatus = attempt.status === "SUBMITTED" || attempt.status === "EVALUATED" ? "completed" : "pending";

  // Calculate analytics
  const totalQuestions = attempt.questionSnapshots?.length || 0;
  const attemptedQuestions = attempt.answers?.length || 0;
  const correctAnswers = attempt.answers?.filter(a => a.isCorrect === true)?.length || 0;

  return {
    data: {
      testId: attempt.testId,
      attemptId: attemptId,
      testName: test?.title || "Test",
      evaluationType,
      evaluationStatus,
      submittedAt: attempt.submittedAt,
      totalScore: attempt.totalScore || 0,
      maxScore: attempt.maxScore || 0,
      percentage: attempt.percentage || 0,
      analytics: {
        total: totalQuestions,
        attempted: attemptedQuestions,
        unattempted: totalQuestions - attemptedQuestions,
        correct: correctAnswers,
        incorrect: attemptedQuestions - correctAnswers,
      },
    },
  };
};

export const updateCheatingStatusService = async (attempt, { cheatingScore, violations }) => {
  if (attempt.status !== "IN_PROGRESS") {
    return { error: "Attempt is not in progress", status: 409 };
  }

  if (typeof cheatingScore === "number") {
    attempt.cheatingScore = cheatingScore;
  }

  if (Array.isArray(violations)) {
    attempt.violations = violations;
  }

  await saveAttemptRepo(attempt);

  return {
    data: {
      attemptId: attempt._id,
      cheatingScore: attempt.cheatingScore,
      violations: attempt.violations,
    },
  };
};
