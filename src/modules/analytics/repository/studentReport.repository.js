import mongoose from "mongoose";
import TestAttempt from "../../../models/testAttempt.model.js";
import User from "../../../models/user.model.js";

const buildAttemptQuery = async (user, { resultId } = {}) => {
  const role = String(user?.role || "").toUpperCase();
  const userId = user?._id || user?.id || null;
  const organizationId = user?.organizationId || null;

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Invalid user id");
  }

  const query = {};

  if (role === "STUDENT") {
    query.studentId = new mongoose.Types.ObjectId(userId);
  } else if (role === "ORGANIZATION") {
    if (!organizationId || !mongoose.Types.ObjectId.isValid(organizationId)) {
      return { query: { _id: null }, role };
    }

    const students = await User.find({
      organizationId: new mongoose.Types.ObjectId(organizationId),
      role: "STUDENT",
      isDeleted: { $ne: true },
    })
      .select("_id")
      .lean();

    const studentIds = students.map((student) => student._id);
    query.studentId = { $in: studentIds };
  } else if (role === "IQPATH_ADMIN") {
    // Admin sees every student's result.
  } else {
    // Default to current user's own attempts for any unrecognized role.
    query.studentId = new mongoose.Types.ObjectId(userId);
  }

  if (resultId) {
    query._id = mongoose.Types.ObjectId.isValid(resultId)
      ? new mongoose.Types.ObjectId(resultId)
      : resultId;
  }

  return { query, role };
};

export const getResultsForUser = async (user, { resultId } = {}) => {
  const { query } = await buildAttemptQuery(user, { resultId });

  return TestAttempt.find(query)
   .populate({
      path: "testId",
      select: "name title duration totalQuestions testSeriesId totalMarks createdBy",
      populate: {
        path: "testSeriesId",
        select: "title description",
      },
    })
   .populate({ path: "studentId", select: "firstName lastName email organizationId role" })
   .select("totalScore maxScore percentage resultStatus createdAt duration submittedAt")
    .sort({ createdAt: -1 })
    .lean();
};
