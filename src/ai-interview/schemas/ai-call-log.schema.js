import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * One row per LLM API attempt (question generation, answer evaluation,
 * feedback generation, embeddings). Used for cost/latency observability and
 * to see how often the interview is running on real AI vs the fallback bank.
 * Rows auto-expire after 180 days.
 */
const aiCallLogSchema = new Schema({
  // The human-readable session id (e.g. "int-...") — a plain string here,
  // not an ObjectId ref, matching how the rest of this module keys turns.
  interviewId: { type: String, index: true, default: null },

  purpose: {
    type: String,
    enum: [
      "question_gen",
      "followup_gen",
      "evaluation",
      "feedback_gen",
      "embedding",
      "tts",
      "stt",
      "other",
    ],
    default: "other",
    index: true,
  },
  provider: { type: String, default: null }, // "gemini" | "openai" | "elevenlabs" | ...
  model: { type: String, default: null },

  tokensIn: { type: Number, default: null },
  tokensOut: { type: Number, default: null },
  latencyMs: { type: Number, default: null },
  attempt: { type: Number, default: 1 }, // 1 = first try, 2 = retry

  status: {
    type: String,
    enum: ["success", "timeout", "error", "rate_limited", "unavailable"],
    default: "error",
    index: true,
  },
  httpStatus: { type: Number, default: null },
  errorMessage: { type: String, default: null },

  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});

export const AiCallLog =
  mongoose.models.AiCallLog || model("AiCallLog", aiCallLogSchema);

export default AiCallLog;
