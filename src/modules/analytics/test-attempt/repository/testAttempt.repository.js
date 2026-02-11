import TestAttempt from "../../../../models/testAttempt.model.js";
import mongoose from "mongoose";

export const findAttemptsByStudent = async (studentId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      throw new Error("Invalid student id");
    }

    const attempts = await TestAttempt.find({
      studentId: new mongoose.Types.ObjectId(studentId),
    })
      .select(
        "testId totalScore maxScore percentage resultStatus submittedAt evaluatedAt"
      )
      .sort({ submittedAt: -1 })
      .lean();

    return attempts;
  } catch (error) {
    throw error;
  }
};