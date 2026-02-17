import mongoose from "mongoose";

const testAttemptSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    testId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
    },
    totalScore: Number,
    maxScore: Number,
    percentage: Number,
    resultStatus: {
      type: String,
      enum: ["PASS", "FAIL"],
      uppercase: true,
      required: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    evaluatedAt: Date,
  },
  { timestamps: true } // ✅ adds createdAt + updatedAt automatically
);

// ✅ Performance Indexes (define only once here)
testAttemptSchema.index({ createdAt: 1 });
testAttemptSchema.index({ testId: 1 });
testAttemptSchema.index({ organizationId: 1 });

export default mongoose.model("TestAttempt", testAttemptSchema);
