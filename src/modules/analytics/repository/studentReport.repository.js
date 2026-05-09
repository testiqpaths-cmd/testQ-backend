import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getStudentResults = async (studentId, { resultId } = {}) => {
  const id = mongoose.Types.ObjectId.isValid(studentId)
    ? new mongoose.Types.ObjectId(studentId)
    : studentId;
  const query = { studentId: id };

  if (resultId) {
    query._id = mongoose.Types.ObjectId.isValid(resultId)
      ? new mongoose.Types.ObjectId(resultId)
      : resultId;
  }

  return TestAttempt.find(query)
   .populate("testId", "name")
   .select("totalScore maxScore percentage resultStatus createdAt duration submittedAt")
    .sort({ createdAt: -1 })
    .lean();
};
