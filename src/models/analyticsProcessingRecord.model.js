import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const difficultyBucketSchema = new Schema(
  {
    correct: { type: Number, required: true },
    wrong: { type: Number, required: true },
    skipped: { type: Number, required: true },
  },
  { _id: false }
);

const canonicalMetricsSchema = new Schema(
  {
    correct: { type: Number, required: true },
    wrong: { type: Number, required: true },
    skipped: { type: Number, required: true },
    pending: { type: Number, required: true },

    totalQuestions: { type: Number, required: true },
    answeredCount: { type: Number, required: true },
    evaluatedCount: { type: Number, required: true },

    score: { type: Number, required: true },
    percentage: { type: Number, required: true },
    timeSpentSeconds: { type: Number, required: true },

    difficultyBreakdown: {
      easy: { type: difficultyBucketSchema, required: true },
      medium: { type: difficultyBucketSchema, required: true },
      hard: { type: difficultyBucketSchema, required: true },
    },
  },
  { _id: false }
);

const analyticsProcessingRecordSchema = new Schema(
  {
    attemptId: {
      type: Schema.Types.ObjectId,
      ref: "TestAttempt",
      required: true,
      immutable: true,
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    testId: {
      type: Schema.Types.ObjectId,
      ref: "Test",
      required: true,
      immutable: true,
    },

    status: {
      type: String,
      enum: ["PROCESSED"],
      required: true,
      default: "PROCESSED",
    },

    score: {
      type: Number,
      required: true,
    },

    percentage: {
      type: Number,
      required: true,
    },

    submittedAt: {
      type: Date,
      required: true,
    },

    processedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // Do not add a default to metricsVersion.
    // Missing version identifies a legacy processing record.
    metricsVersion: {
      type: Number,
      required: false,
    },

    // Canonical metrics that were applied to summaries.
    canonicalMetrics: {
      type: canonicalMetricsSchema,
      required: false,
    },

    // Scope in which the metrics were previously applied.
    subjectKey: {
      type: String,
      required: false,
    },
    subjectName: {
      type: String,
      required: false,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
    },
    dateKey: {
      type: String,
      required: false,
    },
    sourceCategory: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

analyticsProcessingRecordSchema.index(
  { attemptId: 1 },
  { unique: true, name: "unique_processed_attempt" }
);

analyticsProcessingRecordSchema.index(
  { studentId: 1, submittedAt: -1 },
  { name: "student_processed_attempts" }
);

export const getAnalyticsRecordState = (record) => {
  if (!record) {
    return "NEW_RECORD";
  }

  if (
    record.metricsVersion !== 1 ||
    !record.canonicalMetrics
  ) {
    return "LEGACY_BASELINE_REQUIRED";
  }

  return "CANONICAL_BASELINE_AVAILABLE";
};

const AnalyticsProcessingRecord =
  models.AnalyticsProcessingRecord ||
  model("AnalyticsProcessingRecord", analyticsProcessingRecordSchema);

export default AnalyticsProcessingRecord;
