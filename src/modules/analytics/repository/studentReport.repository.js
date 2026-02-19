import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";

export const getStudentResults = async (studentId) => {
  
  const id = mongoose.Types.ObjectId.isValid(studentId)
    ? new mongoose.Types.ObjectId(studentId)
    : studentId;
return TestAttempt.find({ studentId: id })
   .populate("testId", "name")
   .select("totalScore maxScore percentage resultStatus createdAt")
    .sort({ createdAt: -1 })
    .lean();
};
