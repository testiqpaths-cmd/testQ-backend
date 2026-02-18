import mongoose from "mongoose";
import User from "../../../models/user.model.js";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getOrgResults = async (orgId) => {
  // ✅ Ensure orgId is a valid ObjectId
  const orgObjectId = mongoose.Types.ObjectId.isValid(orgId)
    ? new mongoose.Types.ObjectId(orgId)
    : orgId;

  // ✅ Get all students in this organization
  const students = await User.find({ orgId: orgObjectId, role: "STUDENT" })
    .select("_id name email")
    .lean();

  if (!students || !students.length) return [];

  // ✅ Collect all student IDs
  const studentIds = students.map((s) => s._id);

  // ✅ Fetch test attempts for these students
  const results = await TestAttempt.find({ studentId: { $in: studentIds } })
    .populate("testId", "name") // populate test name
    .populate("studentId", "name email") // ✅ populate student info too
    .select("studentId testId totalScore maxScore percentage resultStatus createdAt")
    .lean();

  // ✅ Map into report-ready format
  return results.map((r) => ({
    studentId: r.studentId?._id || "N/A",
    studentName: r.studentId?.name || "Unknown",
    studentEmail: r.studentId?.email || "Unknown",
    testName: r.testId?.name || "N/A",
    score: `${r.totalScore}/${r.maxScore}`,
    percentage: r.percentage ?? 0,
    resultStatus: r.resultStatus,
    date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "N/A",
  }));
};
