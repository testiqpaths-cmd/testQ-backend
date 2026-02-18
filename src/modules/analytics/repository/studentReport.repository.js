import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getStudentResults = async (studentId) => {
  // ✅ Ensure the studentId is in the correct format
  // If it's a valid ObjectId string, convert it to an ObjectId instance.
  // This avoids mismatches when the DB stores studentId as ObjectId but req.user._id is a plain string.
  const id = mongoose.Types.ObjectId.isValid(studentId)
    ? new mongoose.Types.ObjectId(studentId)
    : studentId;

  // ✅ Query the TestAttempt collection for all attempts by this student
  return TestAttempt.find({ studentId: id })
    // Populate the testId field with only the "name" property from the Test collection
    .populate("testId", "name")
    // Select only the relevant fields to include in the report
    .select("totalScore maxScore percentage resultStatus createdAt")
    // Sort results by creation date (latest attempts first)
    .sort({ createdAt: -1 })
    // Convert Mongoose documents into plain JS objects for performance and easier handling
    .lean();
};
