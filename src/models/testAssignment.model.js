import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const testAssignmentSchema = new Schema({
  testId: { type: Types.ObjectId, ref: "Test", required: true },
  studentId: { type: Types.ObjectId, ref: "User", required: true },
  status: {
    type: String,
    enum: ["PENDING", "ACCEPTED", "DECLINED", "STARTED", "SUBMITTED", "MISSED", "HIDDEN"],
    default: "PENDING"
  },
  acceptedAt: { type: Date },
  declinedAt: { type: Date },
  startedAt: { type: Date },
  submittedAt: { type: Date },
  hiddenAt: { type: Date },
  score: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Ensure a student has at most one assignment per test
testAssignmentSchema.index({ testId: 1, studentId: 1 }, { unique: true });

// The admin dashboard counts assignments by status platform-wide
// (assignmentFilter is `{}` on that branch), which only the status field
// can serve.
testAssignmentSchema.index({ status: 1 });

export default model("TestAssignment", testAssignmentSchema);
