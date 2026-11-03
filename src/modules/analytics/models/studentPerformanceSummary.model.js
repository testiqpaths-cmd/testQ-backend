import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const difficultyStatsSchema = new Schema(
  {
    correct: {
      type: Number,
      default: 0,
    },

    wrong: {
      type: Number,
      default: 0,
    },

    skipped: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const subjectStatsSchema = new Schema(
  {
    attemptCount: {
      type: Number,
      default: 0,
    },

    scoreSum: {
      type: Number,
      default: 0,
    },

    scoredAttemptCount: {
      type: Number,
      default: 0,
    },

    timeSpentSeconds: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const studentPerformanceSummarySchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    totalTestsAttempted: {
      type: Number,
      default: 0,
    },

    totalQuestionsAnswered: {
      type: Number,
      default: 0,
    },

    totalCorrectAnswers: {
      type: Number,
      default: 0,
    },

    totalIncorrectAnswers: {
      type: Number,
      default: 0,
    },

    totalUnattemptedQuestions: {
      type: Number,
      default: 0,
    },

    totalScoreSum: {
      type: Number,
      default: 0,
    },

    totalPercentageSum: {
      type: Number,
      default: 0,
    },

    scoredAttemptCount: {
      type: Number,
      default: 0,
    },

    totalTimeSpentSeconds: {
      type: Number,
      default: 0,
    },

    difficultyBreakdown: {
      easy: {
        type: difficultyStatsSchema,
        default: () => ({}),
      },

      medium: {
        type: difficultyStatsSchema,
        default: () => ({}),
      },

      hard: {
        type: difficultyStatsSchema,
        default: () => ({}),
      },
    },

    subjectStats: {
      type: Map,
      of: subjectStatsSchema,
      default: () => new Map(),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

studentPerformanceSummarySchema.index(
  { studentId: 1 },
  {
    unique: true,
    name: "unique_student_performance_summary",
  }
);

const StudentPerformanceSummary =
  models.StudentPerformanceSummary ||
  model("StudentPerformanceSummary", studentPerformanceSummarySchema);

export default StudentPerformanceSummary;
