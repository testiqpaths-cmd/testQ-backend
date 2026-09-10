import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { aiService } from "../ai/ai.service.js";
import { findClosestDuplicate } from "../utils/cosine-similarity.js";
import logger from "../../config/logger.js";

const DEDUP_THRESHOLD = Number(process.env.AI_DEDUP_THRESHOLD) || 0.92;
const PRIOR_LIMIT = Number(process.env.AI_DEDUP_PRIOR_LIMIT) || 150;

export class QuestionDedupService {
  /** Embed a question string. Returns number[] or null (no key / failure). */
  async embedQuestion(text, interviewId = null) {
    return aiService.embed(text, { interviewId });
  }

  /**
   * Recent question embeddings across ALL of this candidate's interviews,
   * optionally scoped to a topic. Newest first, capped. Non-fatal.
   *
   * @returns {Promise<Array<{ question: string, embedding: number[] }>>}
   */
  async getPriorEmbeddings(userId, { topic = null, limit = PRIOR_LIMIT } = {}) {
    try {
      if (!userId) return [];
      const sessions = await InterviewSession.find({ userId }).select("_id").lean();
      const sessionIds = sessions.map((s) => s._id);
      if (!sessionIds.length) return [];

      const query = { sessionId: { $in: sessionIds }, questionEmbedding: { $exists: true } };
      if (topic) query.topic = String(topic).toUpperCase();

      const turns = await InterviewTurn.find(query)
        .select("+questionEmbedding question topic")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return turns
        .filter((t) => Array.isArray(t.questionEmbedding) && t.questionEmbedding.length)
        .map((t) => ({ question: t.question, embedding: t.questionEmbedding }));
    } catch (err) {
      logger.warn(`getPriorEmbeddings failed (non-fatal): ${err.message}`);
      return [];
    }
  }

  /**
   * Is `embedding` a near-duplicate of a question this candidate has been
   * asked before? Returns `{ isDuplicate:false }` on any missing input or
   * error so callers can proceed unguarded.
   */
  async findDuplicate(embedding, userId, { topic = null } = {}) {
    if (!Array.isArray(embedding) || !embedding.length || !userId) {
      return { isDuplicate: false, similarity: 0, closestMatch: null };
    }
    try {
      // Same-topic first (tighter, cheaper); widen to all topics only if
      // the candidate has no prior history on this one.
      let prior = await this.getPriorEmbeddings(userId, { topic });
      if (!prior.length && topic) prior = await this.getPriorEmbeddings(userId, {});
      return findClosestDuplicate(embedding, prior, DEDUP_THRESHOLD);
    } catch (err) {
      logger.warn(`findDuplicate failed (non-fatal): ${err.message}`);
      return { isDuplicate: false, similarity: 0, closestMatch: null };
    }
  }
}

export const questionDedupService = new QuestionDedupService();
export default questionDedupService;
