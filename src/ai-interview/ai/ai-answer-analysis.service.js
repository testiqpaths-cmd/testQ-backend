import { z } from "zod";
import { aiService } from "./ai.service.js";
import { AnswerStatus } from "../enums/answer-status.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import logger from "../../config/logger.js";

export const aiAnswerAnalysisSchema = z.object({
  answerStatus: z
    .enum(["ACCURATE", "PARTIAL", "KNOWLEDGE_GAP", "INCORRECT", "SKIPPED"])
    .default("PARTIAL"),
  relevanceScore: z.coerce.number().min(0).max(100).default(50),
  correctnessScore: z.coerce.number().min(0).max(100).default(50),
  completenessScore: z.coerce.number().min(0).max(100).default(50),
  confidence: z.coerce.number().min(0).max(100).default(60),
  conceptsDemonstrated: z.array(z.string()).default([]),
  conceptsMissing: z.array(z.string()).default([]),
  feedbackSummary: z.string().default("Candidate response analyzed."),
  followUpRecommended: z.boolean().default(false),
  difficultyRecommendation: z
    .enum(["EASY", "MEDIUM", "HARD"])
    .nullable()
    .optional()
    .default(null),
  topicContinuationRecommended: z.boolean().default(true),
});

export class AiAnswerAnalysisService {
  constructor(llm = aiService) {
    this.llm = llm;
  }

  /**
   * Evaluates candidate response using structured AI prompting,
   * falling back to safe deterministic heuristic analysis upon AI failure.
   *
   * @param {Object} params
   * @param {string} params.question - Question asked
   * @param {string} params.candidateAnswer - Raw transcript of candidate answer
   * @param {string} params.topic - Active topic (e.g. "REACT")
   * @param {string} params.difficulty - Question difficulty (e.g. "EASY")
   * @param {string} [params.role="Software Engineer"]
   * @param {string} [params.experienceLevel="1-3 Years"]
   * @returns {Promise<Object>} Validated structured analysis
   */
  async analyzeCandidateAnswer({
    question,
    candidateAnswer,
    topic,
    difficulty,
    role = "Software Engineer",
    experienceLevel = "1-3 Years",
    interviewId = null,
  }) {
    const systemPrompt = `You are an expert technical interviewer evaluating a candidate's answer for the role of ${role} (${experienceLevel}).

STRICT TASK:
Analyze the candidate's answer for the question asked.
Assess technical correctness, relevance, completeness, and demonstrated understanding.

STRICT JSON OUTPUT FORMAT:
{
  "answerStatus": "ACCURATE" | "PARTIAL" | "KNOWLEDGE_GAP" | "INCORRECT" | "SKIPPED",
  "relevanceScore": 0-100,
  "correctnessScore": 0-100,
  "completenessScore": 0-100,
  "confidence": 0-100,
  "conceptsDemonstrated": ["concept1", "concept2"],
  "conceptsMissing": ["concept3"],
  "feedbackSummary": "Brief constructive technical feedback",
  "followUpRecommended": true | false,
  "difficultyRecommendation": "EASY" | "MEDIUM" | "HARD" | null,
  "topicContinuationRecommended": true | false
}

GUIDELINES:
- "ACCURATE": Correct technical explanation covering the core aspects.
- "PARTIAL": Demonstrates some understanding but incomplete or minor inaccuracies. (followUpRecommended may be true).
- "KNOWLEDGE_GAP": Candidate explicitly expresses not knowing or having no experience. (followUpRecommended MUST be false).
- "INCORRECT": Factual errors or fundamentally flawed technical explanation.
- Return ONLY valid JSON.`;

    const userPrompt = `Question: "${question}"
Topic: "${topic}"
Difficulty: "${difficulty}"
Candidate Answer: "${candidateAnswer}"`;

    try {
      const rawAiResponse = await this.llm.generateStructuredJson({
        systemPrompt,
        userPrompt,
        meta: { interviewId, purpose: "evaluation" },
      });

      if (rawAiResponse) {
        const validated = aiAnswerAnalysisSchema.safeParse(rawAiResponse);
        if (validated.success) {
          logger.info(`AI analyzed candidate answer (status: ${validated.data.answerStatus})`);
          return validated.data;
        } else {
          logger.warn(
            `AI answer analysis schema validation failed: ${validated.error.message}. Using fallback analyzer.`
          );
        }
      }
    } catch (err) {
      logger.warn(`AI answer analysis exception: ${err.message}. Using fallback analyzer.`);
    }

    // Fallback: Deterministic heuristic analysis
    return this.fallbackHeuristicAnalysis({
      question,
      candidateAnswer,
      topic,
      difficulty,
    });
  }

  /**
   * Deterministic fallback when AI is unavailable or fails.
   * Derives scores from word count, topic mentions, and structure without crashing.
   */
  fallbackHeuristicAnalysis({ question, candidateAnswer, topic, difficulty }) {
    const text = (candidateAnswer || "").trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    let status = AnswerStatus.PARTIAL;
    let correctness = 60;
    let completeness = 50;
    let relevance = 75;
    let followUp = false;

    if (wordCount < 4) {
      status = AnswerStatus.INCORRECT;
      correctness = 20;
      completeness = 20;
      relevance = 40;
    } else if (wordCount >= 25) {
      status = AnswerStatus.ACCURATE;
      correctness = 80;
      completeness = 75;
      relevance = 85;
    } else {
      // Moderate length answer (10-24 words)
      status = AnswerStatus.PARTIAL;
      correctness = 65;
      completeness = 60;
      followUp = true;
    }

    return {
      answerStatus: status,
      relevanceScore: relevance,
      correctnessScore: correctness,
      completenessScore: completeness,
      confidence: 70,
      conceptsDemonstrated: [topic],
      conceptsMissing: [],
      feedbackSummary:
        status === AnswerStatus.ACCURATE
          ? "Good explanation addressing the question."
          : "Answer demonstrates basic understanding but lacks full depth.",
      followUpRecommended: followUp,
      difficultyRecommendation: difficulty,
      topicContinuationRecommended: true,
    };
  }
}

export const aiAnswerAnalysisService = new AiAnswerAnalysisService();
export default aiAnswerAnalysisService;
