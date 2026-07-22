import TestAttempt from "../../../models/testAttempt.model.js";

export const countAttemptsByTestAndStudentRepo = (testId, studentId) =>
  TestAttempt.countDocuments({ testId, studentId });

export const countEvaluatedAttemptsByTestRepo = (testId) =>
  TestAttempt.countDocuments({ testId, status: "EVALUATED" });

export const countCompletedAttemptsByTestAndStudentRepo = (testId, studentId) =>
  TestAttempt.countDocuments({
    testId,
    studentId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  });

export const createAttemptRepo = (data) => TestAttempt.create(data);

export const findInProgressAttemptByFilterRepo = (filter) =>
  TestAttempt.findOne({ ...filter, status: "IN_PROGRESS" }).lean();

export const countCompletedAttemptsRepo = (filter) =>
  TestAttempt.countDocuments({
    ...filter,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  });

export const saveAttemptRepo = (attemptDoc) => attemptDoc.save();

export const findAttemptByIdRepo = (attemptId) => TestAttempt.findById(attemptId);

export const getAttemptEvaluationSnapshotRepo = (attemptId) =>
  TestAttempt.findById(attemptId)
    .select("testId status submittedAt totalScore percentage maxScore answers questionSnapshots")
    .lean();

export const findExpiredInProgressAttemptsRepo = (now) =>
  TestAttempt.find({ status: "IN_PROGRESS", endsAt: { $lte: now } }).select("_id");

export const submitExpiredAttemptRepo = (id, now) =>
  TestAttempt.updateOne(
    { _id: id, status: "IN_PROGRESS" },
    {
      $set: {
        status: "SUBMITTED",
        submittedAt: now,
        expireReason: "TIME_EXPIRED_AUTO_SUBMIT",
      },
    }
  );

export const findAttemptForMissedSyncRepo = (testId, studentId) =>
  TestAttempt.findOne({ testId, studentId });

export const createMissedAttemptRepo = (data) => TestAttempt.create(data);

export const getAttemptWithPopulatesRepo = (attemptId) =>
  TestAttempt.findById(attemptId)
    .populate({
      path: "testId",
      select: "title name duration totalQuestions testSeriesId createdBy totalMarks",
      populate: {
        path: "testSeriesId",
        select: "title description",
      },
    })
    .populate({
      path: "answers.questionId",
      select: "questionText type options topic subTopic", // ✅ no correctAnswer
    });

export const countAttemptsByTestForClassAverageRepo = (testId) =>
  TestAttempt.find({
    testId,
    status: { $in: ["SUBMITTED", "EVALUATED"] },
  })
    .select("percentage")
    .lean();
