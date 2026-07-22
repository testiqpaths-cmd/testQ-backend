import {
  findAttemptForMissedSyncRepo,
  createMissedAttemptRepo,
  saveAttemptRepo,
} from "../repositories/testAttempt.repository.js";
import { getUserByIdRepo, getAllStudentsRepo } from "../repositories/user.repository.js";
import {
  getAssignmentByTestAndStudentRepo,
  saveAssignmentRepo,
} from "../../test-management/repositories/testAssignment.repository.js";
import { getExpiredPublishedTestsRepo } from "../../test-management/repositories/test.repository.js";

const syncMissed = async (studentId, test, now) => {
  // Find assignment
  const assignment = await getAssignmentByTestAndStudentRepo(test._id, studentId);

  // Only sync missed if they ACCEPTED or STARTED
  if (!assignment || !["ACCEPTED", "STARTED"].includes(assignment.status)) {
    return;
  }

  // Update assignment status to MISSED
  assignment.status = "MISSED";
  assignment.score = 0;
  assignment.submittedAt = test.endTime || now;
  await saveAssignmentRepo(assignment);

  // Find if there is an existing attempt
  const existingAttempt = await findAttemptForMissedSyncRepo(test._id, studentId);

  if (!existingAttempt) {
    await createMissedAttemptRepo({
      testId: test._id,
      studentId,
      status: "MISSED",
      totalScore: 0,
      maxScore: test.totalMarks || 0,
      percentage: 0,
      duration: test.duration || 0,
      startedAt: test.startTime || test.createdAt || now,
      endsAt: test.endTime,
      submittedAt: test.endTime
    });
  } else if (existingAttempt.status === "IN_PROGRESS") {
    existingAttempt.status = "MISSED";
    existingAttempt.totalScore = 0;
    existingAttempt.percentage = 0;
    existingAttempt.submittedAt = test.endTime || now;
    await saveAttemptRepo(existingAttempt);
  }
};

export const syncAllMissedAttempts = async () => {
  try {
    const now = new Date();
    // Find all expired tests that are published, not deleted, and not IQ room tests
    const expiredTests = await getExpiredPublishedTestsRepo(now);

    if (expiredTests.length === 0) return;

    // Get all students
    const students = await getAllStudentsRepo();

    for (const student of students) {
      for (const test of expiredTests) {
        await syncMissed(student._id, test, now);
      }
    }
  } catch (err) {
    console.error("Error in syncAllMissedAttempts service:", err);
  }
};

export const syncMissedAttemptsForStudent = async (studentId) => {
  try {
    const student = await getUserByIdRepo(studentId);
    if (!student) return;

    const now = new Date();
    // Find all expired tests that are published, not deleted, and not IQ room tests
    const expiredTests = await getExpiredPublishedTestsRepo(now);

    for (const test of expiredTests) {
      await syncMissed(studentId, test, now);
    }
  } catch (err) {
    console.error("Error in syncMissedAttemptsForStudent service:", err);
  }
};
