import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { aiService } from "../ai/ai.service.js";
import { findClosestDuplicate } from "../utils/cosine-similarity.js";
import logger from "../../config/logger.js";

const DEDUP_THRESHOLD = Number(process.env.AI_DEDUP_THRESHOLD) || 0.82;
const PRIOR_LIMIT = Number(process.env.AI_DEDUP_PRIOR_LIMIT) || 150;

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokens(str) {
  const stopWords = new Set([
    "what", "is", "the", "a", "an", "in", "to", "of", "and", "or", "how",
    "does", "do", "can", "you", "explain", "describe", "difference", "between",
    "would", "with", "for", "from", "when", "why", "which", "give", "practical"
  ]);
  return new Set(
    normalizeText(str)
      .split(" ")
      .map((w) => (w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w))
      .filter((w) => w.length > 2 && !stopWords.has(w))
  );
}

function calculateJaccardSimilarity(strA, strB) {
  const normA = normalizeText(strA);
  const normB = normalizeText(strB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const setA = getTokens(strA);
  const setB = getTokens(strB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

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

      const query = { sessionId: { $in: sessionIds } };
      if (topic) query.topic = String(topic).toUpperCase();

      const turns = await InterviewTurn.find(query)
        .select("+questionEmbedding question topic")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return turns
        .filter((t) => t.question)
        .map((t) => ({ question: t.question, embedding: t.questionEmbedding || null }));
    } catch (err) {
      logger.warn(`getPriorEmbeddings failed (non-fatal): ${err.message}`);
      return [];
    }
  }

  /**
   * Is `embedding` or `questionText` a duplicate/near-duplicate of a question
   * this candidate has been asked before or in this session?
   * Returns `{ isDuplicate:false }` on missing input or error so callers can proceed.
   */
  async findDuplicate(embedding, userId, { topic = null, questionText = null, sessionQuestions = [] } = {}) {
    try {
      // 1. Check exact / token overlap against current session questions first
      if (questionText && Array.isArray(sessionQuestions) && sessionQuestions.length > 0) {
        for (const prevQ of sessionQuestions) {
          if (!prevQ) continue;
          if (normalizeText(questionText) === normalizeText(prevQ)) {
            return { isDuplicate: true, similarity: 1.0, closestMatch: { question: prevQ }, reason: "exact_session_match" };
          }
          const jaccard = calculateJaccardSimilarity(questionText, prevQ);
          if (jaccard >= 0.60) {
            return { isDuplicate: true, similarity: jaccard, closestMatch: { question: prevQ }, reason: "jaccard_session_match" };
          }
        }
      }

      // 2. Cross-interview checks: fetch prior turns
      let prior = await this.getPriorEmbeddings(userId, { topic });
      if (!prior.length && topic) prior = await this.getPriorEmbeddings(userId, {});

      if (!prior.length) {
        return { isDuplicate: false, similarity: 0, closestMatch: null };
      }

      // 2a. Check textual match against prior questions
      if (questionText) {
        for (const item of prior) {
          if (!item.question) continue;
          if (normalizeText(questionText) === normalizeText(item.question)) {
            return { isDuplicate: true, similarity: 1.0, closestMatch: item, reason: "exact_prior_match" };
          }
          const jaccard = calculateJaccardSimilarity(questionText, item.question);
          if (jaccard >= 0.60) {
            return { isDuplicate: true, similarity: jaccard, closestMatch: item, reason: "jaccard_prior_match" };
          }
        }
      }

      // 2b. Check embedding cosine similarity if vector is available
      if (Array.isArray(embedding) && embedding.length > 0) {
        const withVectors = prior.filter((p) => Array.isArray(p.embedding) && p.embedding.length);
        if (withVectors.length > 0) {
          return findClosestDuplicate(embedding, withVectors, DEDUP_THRESHOLD);
        }
      }

      return { isDuplicate: false, similarity: 0, closestMatch: null };
    } catch (err) {
      logger.warn(`findDuplicate failed (non-fatal): ${err.message}`);
      return { isDuplicate: false, similarity: 0, closestMatch: null };
    }
  }
}

export const questionDedupService = new QuestionDedupService();
export default questionDedupService;
