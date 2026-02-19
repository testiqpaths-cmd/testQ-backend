import mongoose from "mongoose";

const testAttemptSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization" },
    totalScore: Number,
    maxScore: Number,
    percentage: Number,
    resultStatus: { type: String, enum: ["PASS", "FAIL"], uppercase: true, required: true },
    submittedAt: { type: Date, default: Date.now },
    evaluatedAt: Date,
  },
  { timestamps: true }
);

// ✅ Performance Indexes
testAttemptSchema.index({ createdAt: -1 });
testAttemptSchema.index({ testId: 1 });
testAttemptSchema.index({ organizationId: 1 });
testAttemptSchema.index({ studentId: 1 });
testAttemptSchema.index({ resultStatus: 1 });

// ✅ Compound Indexes (optional, if queries combine filters)
testAttemptSchema.index({ testId: 1, createdAt: -1 });
testAttemptSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.model("TestAttempt", testAttemptSchema);
