import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

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

const AnalyticsProcessingRecord =
  models.AnalyticsProcessingRecord ||
  model("AnalyticsProcessingRecord", analyticsProcessingRecordSchema);

export default AnalyticsProcessingRecord;
