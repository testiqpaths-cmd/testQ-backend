import mongoose from "mongoose";

const testAttemptSchema = new mongoose.Schema(
  {
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
      required: true,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    duration: {
      type: Number,
      required: true,
    },

    questionSnapshots: [
      {
        questionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
          required: true,
        },
        questionText: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          required: true,
        },
        options: {
          type: [String],
          default: [],
        },
        correctAnswer: {
          type: String,
          default: null,
        },
        marks: {
          type: Number,
          default: 0,
        },
        order: {
          type: Number,
          required: true,
        },
        startedAt: {
          type: Date,
          default: null,
        },
        lastViewedAt: {
          type: Date,
          default: null,
        },
        timeSpentMs: {
          type: Number,
          default: 0,
        },
      },
    ],

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
        selectedOption: {
          type: String,
          default: null,
        },
        textAnswer: {
          type: String,
          default: null,
        },
        answeredAt: {
          type: Date,
          default: Date.now,
        },
      timeSpentMs: {
        type: Number,
        default: 0,
      },
        marksObtained: {
          type: Number,
          default: 0,
        },
        isCorrect: {
          type: Boolean,
          default: null,
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
      enum: ["TIME_EXPIRED", "MANUAL_SUBMIT", "TIME_EXPIRED_AUTO_SUBMIT", null],
      default: null,
    },
  },
  { timestamps: true }
);

testAttemptSchema.index({ testId: 1, studentId: 1 }, { unique: true });

export default mongoose.model("TestAttempt", testAttemptSchema);