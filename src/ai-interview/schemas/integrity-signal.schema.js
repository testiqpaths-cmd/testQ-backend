import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

export const INTEGRITY_SIGNAL_TYPES = [
  "tab_switch",
  "no_face",
  "multi_face",
  "long_silence",
  "audio_anomaly",
  "mobile_phone_detected",
];

/**
 * A single observed proctoring event during an AI interview. These are
 * DESCRIPTIVE ONLY — the results/report layer surfaces raw counts and
 * never derives a pass/fail or cheating verdict from them.
 */
const integritySignalSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    interviewId: {
      type: String,
      required: true,
      index: true,
    },
    signalType: {
      type: String,
      enum: INTEGRITY_SIGNAL_TYPES,
      required: true,
    },
    detectedAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

integritySignalSchema.index({ sessionId: 1, detectedAt: 1 });

export const IntegritySignal =
  mongoose.models.IntegritySignal || model("IntegritySignal", integritySignalSchema);

export default IntegritySignal;
