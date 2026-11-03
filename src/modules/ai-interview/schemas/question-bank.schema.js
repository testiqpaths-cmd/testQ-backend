import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

/**
 * A growing pool of interview questions. Every question the AI successfully
 * generates (and that passes validation) is saved here; when the AI is slow
 * or unavailable, question generation pulls an unused one from this bank
 * before falling back to the small hardcoded fallback-questions.js file.
 *
 * reviewStatus is kept for a later admin-curation pass — right now
 * validated AI questions are stored "approved" and reusable immediately.
 */
const questionBankSchema = new Schema(
  {
    question: { type: String, required: true, trim: true },
    // sha256 of the normalized question text — unique so the same question
    // is never stored twice.
    questionHash: { type: String, required: true, unique: true, index: true },

    topic: { type: String, index: true },
    difficulty: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD", "ADAPTIVE"],
      index: true,
    },
    questionType: {
      type: String,
      enum: ["TECHNICAL", "CONCEPTUAL", "PROBLEM_SOLVING", "BEHAVIORAL", "PROJECT", "HR"],
      default: "TECHNICAL",
    },
    competency: { type: String, default: "Technical Knowledge" },
    isFollowUp: { type: Boolean, default: false },

    roles: { type: [String], default: [] },
    experienceLevels: { type: [String], default: [] },

    source: {
      type: String,
      enum: ["admin", "ai_generated"],
      required: true,
    },
    reviewStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    qualityScore: { type: Number, default: null },
    timesServed: { type: Number, default: 0 },
    lastServedAt: { type: Date, default: null },
    version: { type: Number, default: 1 },

    createdByModel: { type: String, default: null }, // which LLM produced it
    createdBy: { type: Types.ObjectId, ref: "User", default: null }, // admin author, if any
  },
  { timestamps: true }
);

// The exact shape of the "give me a fallback question" query.
questionBankSchema.index({ topic: 1, difficulty: 1, reviewStatus: 1, isFollowUp: 1 });

export const QuestionBank =
  mongoose.models.QuestionBank || model("QuestionBank", questionBankSchema);

export default QuestionBank;
