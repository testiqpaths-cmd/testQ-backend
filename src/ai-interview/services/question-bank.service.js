import crypto from "crypto";
import { QuestionBank } from "../schemas/question-bank.schema.js";
import logger from "../../config/logger.js";

const norm = (v) => String(v || "").toUpperCase();

export class QuestionBankService {
  hashQuestion(text) {
    const normalized = String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * Persists a freshly AI-generated question so future interviews can reuse
   * it when the AI is unavailable. Non-fatal: any failure here is logged
   * and swallowed — it must never break the interview flow.
   */
  async saveGeneratedQuestion({
    question,
    topic,
    difficulty,
    questionType,
    competency,
    role,
    experienceLevel,
    isFollowUp = false,
    model = null,
  }) {
    try {
      const text = String(question || "").trim();
      if (!text) return;

      const questionHash = this.hashQuestion(text);
      await QuestionBank.updateOne(
        { questionHash },
        {
          $setOnInsert: {
            question: text,
            questionHash,
            topic: norm(topic),
            difficulty: norm(difficulty),
            questionType: questionType || "TECHNICAL",
            competency: competency || "Technical Knowledge",
            isFollowUp: Boolean(isFollowUp),
            source: "ai_generated",
            reviewStatus: "approved",
            createdByModel: model,
          },
          $addToSet: {
            ...(role ? { roles: role } : {}),
            ...(experienceLevel ? { experienceLevels: experienceLevel } : {}),
          },
        },
        { upsert: true }
      );
    } catch (err) {
      // A duplicate-key race is expected and harmless; anything else is
      // just logged.
      if (err?.code !== 11000) {
        logger.warn(`QuestionBank save failed (non-fatal): ${err.message}`);
      }
    }
  }

  /**
   * Pulls one previously-generated question from the bank matching the
   * requested topic/difficulty, excluding anything already asked this
   * session. Returns null if the bank has nothing suitable (caller then
   * uses the hardcoded fallback file).
   */
  async getBankQuestion({ topic, difficulty, excludeQuestions = [], role = null, isFollowUp = false }) {
    try {
      const T = norm(topic);
      const D = norm(difficulty);
      const excluded = (excludeQuestions || []).map((q) => String(q || "").trim()).filter(Boolean);

      const base = {
        reviewStatus: "approved",
        isFollowUp: Boolean(isFollowUp),
        question: { $nin: excluded },
      };

      // Try, in order: exact topic+difficulty, then topic (any difficulty).
      const attempts = [
        { ...base, topic: T, difficulty: D },
        { ...base, topic: T },
      ];

      for (const match of attempts) {
        const [doc] = await QuestionBank.aggregate([
          { $match: match },
          { $sample: { size: 1 } },
        ]);
        if (doc) {
          // Best-effort usage bump; ignore failures.
          QuestionBank.updateOne(
            { _id: doc._id },
            { $inc: { timesServed: 1 }, $set: { lastServedAt: new Date() } }
          ).catch(() => {});

          logger.info(`Served QuestionBank question for ${T} (${D || "any"}) [${doc._id}]`);
          return {
            question: doc.question,
            topic: doc.topic || T,
            difficulty: doc.difficulty || D || "EASY",
            questionType: doc.questionType || "TECHNICAL",
            competency: doc.competency || "Technical Knowledge",
            questionBankId: doc._id.toString(),
          };
        }
      }
      return null;
    } catch (err) {
      logger.warn(`QuestionBank lookup failed (non-fatal): ${err.message}`);
      return null;
    }
  }
}

export const questionBankService = new QuestionBankService();
export default questionBankService;
