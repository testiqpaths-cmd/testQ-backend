import Test from "../../../models/test.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";
import User from "../../../models/user.model.js";
import TestAssignment from "../../../models/testAssignment.model.js";

const syncMissed = async (studentId, test, now) => {
  // Find assignment
  const assignment = await TestAssignment.findOne({ testId: test._id, studentId });
  
  // Only sync missed if they ACCEPTED or STARTED
  if (!assignment || !["ACCEPTED", "STARTED"].includes(assignment.status)) {
    return;
  }

  // Update assignment status to MISSED
  assignment.status = "MISSED";
  assignment.score = 0;
  assignment.submittedAt = test.endTime || now;
  await assignment.save();

  // Find if there is an existing attempt
  const existingAttempt = await TestAttempt.findOne({
    testId: test._id,
    studentId
  });

  if (!existingAttempt) {
    await TestAttempt.create({
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
    await existingAttempt.save();
  }
};

export const syncAllMissedAttempts = async () => {
  try {
    const now = new Date();
    // Find all expired tests that are published, not deleted, and not IQ room tests
    const expiredTests = await Test.find({
      isPublished: true,
      isDeleted: { $ne: 1 },
      isIQRoomTest: { $ne: true },
      endTime: { $lt: now }
    });

    if (expiredTests.length === 0) return;

    // Get all students
    const students = await User.find({ role: "STUDENT" });

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
    const now = new Date();

    // Start from this student's own live assignments. syncMissed() only ever
    // acts on ACCEPTED/STARTED ones, so scanning every expired test on the
    // platform (one query each, run one after another) was pure overhead that
    // grew with the total number of tests ever created, not with this student.
    const liveAssignments = await TestAssignment.find({
      studentId,
      status: { $in: ["ACCEPTED", "STARTED"] },
    })
      .select("testId")
      .lean();

    if (liveAssignments.length === 0) return;

    const expiredTests = await Test.find({
      _id: { $in: liveAssignments.map((a) => a.testId) },
      isPublished: true,
      isDeleted: { $ne: 1 },
      isIQRoomTest: { $ne: true },
      endTime: { $lt: now },
    })
      .select("_id endTime totalMarks duration startTime createdAt")
      .lean();

    for (const test of expiredTests) {
      await syncMissed(studentId, test, now);
    }
  } catch (err) {
    console.error("Error in syncMissedAttemptsForStudent service:", err);
  }
};
