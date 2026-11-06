import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

/**
 * A per-candidate rollup of how they've performed on a topic/concept
 * across ALL their interviews. The question planner reads this (instead of
 * scanning raw InterviewTurns) to pick a sensible starting difficulty when
 * a candidate has history with a topic.
 */
const candidateConceptHistorySchema = new Schema(
  {
    candidateId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    topic: { type: String, required: true },
    // "*" for the topic-level rollup; a specific concept name otherwise.
    concept: { type: String, default: "*" },

    bestScore: { type: Number, default: 0 }, // best correctness score ever seen
    lastScore: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 }, // latest confidence
    timesAssessed: { type: Number, default: 0 },
    lastAssessedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

candidateConceptHistorySchema.index(
  { candidateId: 1, topic: 1, concept: 1 },
  { unique: true }
);

export const CandidateConceptHistory =
  mongoose.models.CandidateConceptHistory ||
  model("CandidateConceptHistory", candidateConceptHistorySchema);

export default CandidateConceptHistory;
