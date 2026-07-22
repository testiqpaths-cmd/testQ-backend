import TestAssignment from "../../../models/testAssignment.model.js";

export const upsertAssignmentStatusRepo = (testId, studentId, fields) =>
  TestAssignment.findOneAndUpdate(
    { testId, studentId },
    fields,
    { new: true, upsert: true }
  );

export const getAssignmentByTestAndStudentRepo = (testId, studentId) =>
  TestAssignment.findOne({ testId, studentId });

export const saveAssignmentRepo = (assignmentDoc) => assignmentDoc.save();

export const markAssignmentStartedFromAttemptRepo = (testId, studentId, startedAt) =>
  TestAssignment.updateOne(
    { testId, studentId },
    { $set: { status: "STARTED", startedAt } }
  );

export const markAssignmentSubmittedRepo = (testId, studentId, { submittedAt, score }) =>
  TestAssignment.updateOne(
    { testId, studentId },
    { $set: { status: "SUBMITTED", submittedAt, score } },
    { upsert: true }
  );

export const getAssignmentsForTestsRepo = (studentId, testIds) =>
  TestAssignment.find({
    studentId,
    testId: { $in: testIds },
  }).lean();
