import { CandidateConceptHistory } from "../schemas/candidate-concept-history.schema.js";
import logger from "../../config/logger.js";

const norm = (v) => String(v || "").trim().toUpperCase();

export class ConceptHistoryService {
  /**
   * Folds one analyzed turn into the candidate's rolling history — a
   * topic-level row plus one row per demonstrated concept. Fully non-fatal.
   *
   * @param {mongoose.Types.ObjectId|string} candidateId
   * @param {Object} turn - an analyzed InterviewTurn (topic, correctnessScore, confidence, conceptsDemonstrated)
   */
  async recordTurn(candidateId, turn) {
    try {
      if (!candidateId || !turn?.topic) return;
      const score = Number(turn.correctnessScore ?? 0);
      const confidence = Number(turn.confidence ?? 0);
      const now = new Date();

      const keys = [
        { topic: norm(turn.topic), concept: "*" },
        ...(turn.conceptsDemonstrated || [])
          .filter(Boolean)
          .slice(0, 5)
          .map((c) => ({ topic: norm(turn.topic), concept: norm(c) })),
      ];

      await Promise.all(
        keys.map(async ({ topic, concept }) => {
          const existing = await CandidateConceptHistory.findOne({ candidateId, topic, concept });
          if (!existing) {
            await CandidateConceptHistory.create({
              candidateId,
              topic,
              concept,
              bestScore: score,
              lastScore: score,
              avgScore: score,
              confidence,
              timesAssessed: 1,
              lastAssessedAt: now,
            });
            return;
          }
          const n = existing.timesAssessed + 1;
          existing.avgScore = Math.round((existing.avgScore * existing.timesAssessed + score) / n);
          existing.bestScore = Math.max(existing.bestScore, score);
          existing.lastScore = score;
          existing.confidence = confidence;
          existing.timesAssessed = n;
          existing.lastAssessedAt = now;
          await existing.save();
        })
      );
    } catch (err) {
      logger.warn(`ConceptHistory recordTurn failed (non-fatal): ${err.message}`);
    }
  }

  /** Topic-level best score for a candidate, or null if never assessed. */
  async getTopicBestScore(candidateId, topic) {
    try {
      const row = await CandidateConceptHistory.findOne({
        candidateId,
        topic: norm(topic),
        concept: "*",
      }).lean();
      return row ? row.bestScore : null;
    } catch {
      return null;
    }
  }

  /** Full rollup for a candidate (topic-level rows first, newest first). */
  async getForCandidate(candidateId) {
    const rows = await CandidateConceptHistory.find({ candidateId })
      .sort({ lastAssessedAt: -1 })
      .lean();
    return rows.map((r) => ({
      topic: r.topic,
      concept: r.concept === "*" ? null : r.concept,
      bestScore: r.bestScore,
      lastScore: r.lastScore,
      avgScore: r.avgScore,
      confidence: r.confidence,
      timesAssessed: r.timesAssessed,
      lastAssessedAt: r.lastAssessedAt,
    }));
  }
}

export const conceptHistoryService = new ConceptHistoryService();
export default conceptHistoryService;
