import mongoose from "mongoose";

const testAttemptSchema = new mongoose.Schema({
  testId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Test",
    required: true,
  },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  startedAt: {
    type: Date,
    default: Date.now,
  },
  endsAt: {
     type: Date, 
     required: true 
},


  submittedAt: {
    type: Date,
    default: null,
  },

  duration: {
    type: Number, // in minutes or seconds (your choice)
    required: true,
  },

  status: {
    type: String,
    enum: ["IN_PROGRESS", "SUBMITTED", "EVALUATED", "EXPIRED"],
    default: "IN_PROGRESS",
  },

  answers: [
    {
      questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
        required: true,
      },

      // MCQ / TRUE_FALSE
      selectedOption: {
        type: String,
        default: null,
      },

      // SHORT / LONG
      textAnswer: {
        type: String,
        default: null,
      },

      answeredAt: {
        type: Date,
        default: Date.now,
      },

      marksObtained: {
        type: Number,
        default: 0,
      },

      isCorrect: {
        type: Boolean,
        default: null, // null = not evaluated yet
      },
    },
  ],

  totalScore: {
    type: Number,
    default: 0,
  },

  maxScore: {
    type: Number,
    required: true,
  },

  percentage: {
    type: Number,
    default: 0,
  },

  resultStatus: {
    type: String,
    enum: ["PASS", "FAIL"],
    default: null,
  },

  expireReason: {
    type: String,
    enum: ["TIME_EXPIRED", "MANUAL_SUBMIT","TIME_EXPIRED_AUTO_SUBMIT", null],
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

/**
 * ✅ One attempt per student per test
 */
testAttemptSchema.index(
  { testId: 1, studentId: 1 },
  { unique: true }
);

export default mongoose.model("TestAttempt", testAttemptSchema);

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
