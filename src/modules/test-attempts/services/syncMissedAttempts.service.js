import Test from "../../../models/test.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";
import User from "../../../models/user.model.js";

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
        let isAssigned = false;
        if (test.visibility === "PUBLIC") {
          isAssigned = true;
        } else if (test.visibility === "ORG_ONLY") {
          const studentOrgIdStr = student.organizationId ? String(student.organizationId) : "";
          const allowedOrgs = Array.isArray(test.allowedOrganizations)
            ? test.allowedOrganizations.map(id => String(id))
            : [];
          if (studentOrgIdStr && allowedOrgs.includes(studentOrgIdStr)) {
            isAssigned = true;
          }
        }

        if (!isAssigned) continue;

        // Check if student already has any attempts for this test
        const attemptsCount = await TestAttempt.countDocuments({
          testId: test._id,
          studentId: student._id
        });

        if (attemptsCount === 0) {
          await TestAttempt.create({
            testId: test._id,
            studentId: student._id,
            status: "MISSED",
            totalScore: 0,
            maxScore: test.totalMarks || 0,
            percentage: 0,
            duration: test.duration || 0,
            startedAt: test.startTime || test.createdAt || now,
            endsAt: test.endTime,
            submittedAt: test.endTime
          });
        }
      }
    }
  } catch (err) {
    console.error("Error in syncAllMissedAttempts service:", err);
  }
};

export const syncMissedAttemptsForStudent = async (studentId) => {
  try {
    const student = await User.findById(studentId);
    if (!student) return;

    const now = new Date();
    // Find all expired tests that are published, not deleted, and not IQ room tests
    const expiredTests = await Test.find({
      isPublished: true,
      isDeleted: { $ne: 1 },
      isIQRoomTest: { $ne: true },
      endTime: { $lt: now }
    });

    for (const test of expiredTests) {
      let isAssigned = false;
      if (test.visibility === "PUBLIC") {
        isAssigned = true;
      } else if (test.visibility === "ORG_ONLY") {
        const studentOrgIdStr = student.organizationId ? String(student.organizationId) : "";
        const allowedOrgs = Array.isArray(test.allowedOrganizations)
          ? test.allowedOrganizations.map(id => String(id))
          : [];
        if (studentOrgIdStr && allowedOrgs.includes(studentOrgIdStr)) {
          isAssigned = true;
        }
      }

      if (!isAssigned) continue;

      // Check if student already has any attempts for this test
      const attemptsCount = await TestAttempt.countDocuments({
        testId: test._id,
        studentId: student._id
      });

      if (attemptsCount === 0) {
        await TestAttempt.create({
          testId: test._id,
          studentId: student._id,
          status: "MISSED",
          totalScore: 0,
          maxScore: test.totalMarks || 0,
          percentage: 0,
          duration: test.duration || 0,
          startedAt: test.startTime || test.createdAt || now,
          endsAt: test.endTime,
          submittedAt: test.endTime
        });
      }
    }
  } catch (err) {
    console.error("Error in syncMissedAttemptsForStudent service:", err);
  }
};
