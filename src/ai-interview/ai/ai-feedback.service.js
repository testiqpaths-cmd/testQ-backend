import { z } from "zod";
import { aiService } from "./ai.service.js";
import logger from "../../config/logger.js";

const KNOWN_LABELS = {
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  "NODE.JS": "Node.js",
  NODEJS: "Node.js",
  "NEXT.JS": "Next.js",
  MONGODB: "MongoDB",
  POSTGRESQL: "PostgreSQL",
  GRAPHQL: "GraphQL",
  HTML: "HTML",
  CSS: "CSS",
  SQL: "SQL",
};

const label = (value) => {
  const key = String(value || "").toUpperCase();
  if (KNOWN_LABELS[key]) return KNOWN_LABELS[key];
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const perQuestionFeedbackSchema = z.object({
  turnNumber: z.coerce.number(),
  whatWasGood: z.string(),
  whatToImprove: z.string(),
  idealAnswer: z.string(),
});

export const aiFeedbackSchema = z.object({
  overallFeedback: z.string(),
  perQuestion: z.array(perQuestionFeedbackSchema).default([]),
});

export class AiFeedbackService {
  constructor(llm = aiService) {
    this.llm = llm;
  }

  /**
   * Generates a narrative interview summary + per-question "what was
   * good"/"what to improve"/"ideal answer" text, using the same
   * try-AI-then-heuristic-fallback shape as ai-answer-analysis.service.js.
   *
   * @param {Object} params
   * @param {string} params.role
   * @param {string} params.experienceLevel
   * @param {number} params.score
   * @param {number} params.readinessScore
   * @param {string[]} params.strengths
   * @param {string[]} params.weaknesses
   * @param {Array<Object>} params.turnsSummary - [{turnNumber, topic, question, answerStatus, correctnessScore, conceptsDemonstrated, conceptsMissing, candidateAnswer}]
   * @returns {Promise<{overallFeedback: string, perQuestion: Array}>}
   */
  async generateInterviewFeedback({
    role,
    experienceLevel,
    score,
    readinessScore,
    strengths,
    weaknesses,
    turnsSummary,
    interviewId = null,
  }) {
    const systemPrompt = `You are an expert technical interview coach reviewing a completed mock interview.

STRICT TASK:
Write an encouraging but honest overall summary, and per-question feedback for each turn provided.

STRICT JSON OUTPUT FORMAT:
{
  "overallFeedback": "2-4 sentence narrative summary of performance",
  "perQuestion": [
    { "turnNumber": number, "whatWasGood": "1-2 sentences", "whatToImprove": "1-2 sentences", "idealAnswer": "1-3 sentences describing what a strong answer would cover" }
  ]
}

Return ONLY valid JSON, one perQuestion entry per turn provided.`;

    const userPrompt = `Role: ${role} (${experienceLevel}).
Overall score: ${score}/100, Readiness: ${readinessScore}/100.
Strengths: ${(strengths || []).join(", ") || "none identified"}.
Weaknesses: ${(weaknesses || []).join(", ") || "none identified"}.

Turns:
${JSON.stringify(turnsSummary)}`;

    try {
      const raw = await this.llm.generateStructuredJson({
        systemPrompt,
        userPrompt,
        meta: { interviewId, purpose: "feedback_gen" },
      });
      if (raw) {
        const validated = aiFeedbackSchema.safeParse(raw);
        if (validated.success) {
          logger.info("AI generated interview feedback successfully.");
          return validated.data;
        }
        logger.warn(`AI feedback schema validation failed: ${validated.error.message}. Using fallback.`);
      }
    } catch (err) {
      logger.warn(`AI feedback generation exception: ${err.message}. Using fallback.`);
    }

    return this.fallbackFeedback({ role, score, readinessScore, strengths, weaknesses, turnsSummary });
  }

  /**
   * Deterministic fallback built only from fields already stored on each
   * turn — no AI call, used whenever AI is unavailable or fails.
   */
  fallbackFeedback({ role, score, readinessScore, strengths, weaknesses, turnsSummary }) {
    const overallFeedback =
      `You answered ${turnsSummary.length} question${turnsSummary.length === 1 ? "" : "s"} in this ${role} interview, ` +
      `scoring ${score}/100 overall (readiness: ${readinessScore}/100). ` +
      (strengths?.length ? `You performed strongest on ${strengths.slice(0, 2).join(" and ")}. ` : "") +
      (weaknesses?.length ? `Focus your next practice on ${weaknesses.slice(0, 2).join(" and ")}. ` : "") +
      (score >= 75
        ? "Overall, you're demonstrating strong readiness for real interviews at this level."
        : score >= 50
        ? "You're making solid progress — targeted practice will meaningfully raise your readiness."
        : "Revisit fundamentals in your weaker areas before your next attempt.");

    const perQuestion = turnsSummary.map((t) => {
      const demonstrated = (t.conceptsDemonstrated || []).slice(0, 3).map(label);
      const missing = (t.conceptsMissing || []).slice(0, 3).map(label);
      const topicLabel = label(t.topic);

      const whatWasGood = demonstrated.length
        ? `You correctly demonstrated understanding of ${demonstrated.join(", ")}.`
        : t.answerStatus === "ACCURATE"
        ? "Your answer was accurate and addressed the question directly."
        : "You engaged with the question and attempted a relevant answer.";

      const whatToImprove = missing.length
        ? `Review ${missing.join(", ")} to round out your understanding of this topic.`
        : t.answerStatus === "KNOWLEDGE_GAP"
        ? `This is a knowledge gap — spend focused time studying ${topicLabel} fundamentals.`
        : t.feedbackSummary || "Add more specific detail and a concrete example next time.";

      const idealAnswer = t.feedbackSummary
        ? `A strong answer would ${t.feedbackSummary.charAt(0).toLowerCase()}${t.feedbackSummary.slice(1)}`
        : `A strong answer clearly explains ${topicLabel}, gives a concrete example, and states the trade-offs or outcome.`;

      return { turnNumber: t.turnNumber, whatWasGood, whatToImprove, idealAnswer };
    });

    return { overallFeedback, perQuestion };
  }
}

export const aiFeedbackService = new AiFeedbackService();
export default aiFeedbackService;
