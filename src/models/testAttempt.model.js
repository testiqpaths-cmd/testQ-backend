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

    iqRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IQRoom",
      default: null,
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
        imageUrl: {
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
      enum: ["IN_PROGRESS", "SUBMITTED", "EVALUATED", "EXPIRED", "MISSED"],
      default: "IN_PROGRESS",
    },

    cheatingScore: {
      type: Number,
      default: 0,
    },

    violations: [
      {
        type: { type: String, required: true },
        timestamp: { type: Number, required: true },
        score: { type: Number, default: 0 },
      },
    ],

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
    rank: {
      type: Number,
      default: null,
    },

    percentile: {
      type: Number,
      default: 0,
    },

    correctAnswersCount: {
      type: Number,
      default: 0,
    },

    incorrectAnswersCount: {
      type: Number,
      default: 0,
    },

    unattemptedCount: {
      type: Number,
      default: 0,
    },

    accuracy: {
      type: Number,
      default: 0,
    },

    timeTakenSeconds: {
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
      enum: ["TIME_EXPIRED", "MANUAL_SUBMIT", "TIME_EXPIRED_AUTO_SUBMIT", "CHEATING", null],
      default: null,
    },
  },
  { timestamps: true },
);

// Allow multiple attempts over time, but only one active attempt at a time.
testAttemptSchema.index(
  { testId: 1, studentId: 1, status: 1,totalScore: -1,
  timeTakenSeconds: 1, },
  {
    unique: true,
    partialFilterExpression: { status: "IN_PROGRESS" },
  },
);

export default mongoose.model("TestAttempt", testAttemptSchema);
