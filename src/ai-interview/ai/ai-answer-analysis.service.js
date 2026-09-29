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
  depthLevel: z.enum(["SHALLOW", "ADEQUATE", "DEEP"]).default("ADEQUATE"),
  conceptsDemonstrated: z.array(z.string()).default([]),
  conceptsMissing: z.array(z.string()).default([]),
  isExplicitGap: z.boolean().default(false),
  feedbackSummary: z.string().default("Candidate response analyzed."),
  followUpRecommended: z.boolean().default(false),
  followUpReason: z.string().optional().default(""),
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
    const systemPrompt = `You are an expert technical interviewer for TestQ evaluating a candidate's answer for the role of ${role} (${experienceLevel}).

STRICT TASK:
Analyze the candidate's answer for the question asked.
Assess technical correctness, relevance, completeness, depth, and whether a follow-up question is warranted.

STRICT JSON OUTPUT FORMAT:
{
  "answerStatus": "ACCURATE" | "PARTIAL" | "KNOWLEDGE_GAP" | "INCORRECT" | "SKIPPED",
  "relevanceScore": 0-100,
  "correctnessScore": 0-100,
  "completenessScore": 0-100,
  "confidence": 0-100,
  "depthLevel": "SHALLOW" | "ADEQUATE" | "DEEP",
  "conceptsDemonstrated": ["concept1", "concept2"],
  "conceptsMissing": ["concept3"],
  "isExplicitGap": false,
  "feedbackSummary": "Brief constructive technical feedback",
  "followUpRecommended": true | false,
  "followUpReason": "Why a follow-up should or should not be asked",
  "difficultyRecommendation": "EASY" | "MEDIUM" | "HARD" | null,
  "topicContinuationRecommended": true | false
}

GUIDELINES:
- "ACCURATE": Core technical points are correct.
  - If the answer is accurate but brief/high-level/shallow, or mentions a technical claim without elaboration, mark depthLevel: "SHALLOW" and set followUpRecommended: true.
  - If the answer is comprehensive and solid, mark depthLevel: "DEEP" and set followUpRecommended: false.
- "PARTIAL": Demonstrates some understanding but incomplete, missing key mechanisms, or lacks depth. Set depthLevel: "SHALLOW", followUpRecommended: true.
- "KNOWLEDGE_GAP": Candidate explicitly expresses not knowing, having no experience, or passes (e.g. "I don't know", "not sure", "haven't used this"). Mark isExplicitGap: true, followUpRecommended MUST be false.
- "INCORRECT": Factual errors or fundamentally flawed technical explanation. followUpRecommended: false.
- Return ONLY valid JSON matching the format.`;

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
          logger.info(`AI analyzed candidate answer (status: ${validated.data.answerStatus}, depth: ${validated.data.depthLevel}, followUp: ${validated.data.followUpRecommended})`);
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
    let depth = "ADEQUATE";
    let followUp = false;

    if (wordCount < 4) {
      status = AnswerStatus.INCORRECT;
      correctness = 20;
      completeness = 20;
      relevance = 40;
      depth = "SHALLOW";
    } else if (wordCount >= 25) {
      status = AnswerStatus.ACCURATE;
      correctness = 80;
      completeness = 75;
      relevance = 85;
      depth = "DEEP";
    } else {
      // Moderate length answer (4-24 words)
      status = AnswerStatus.PARTIAL;
      correctness = 65;
      completeness = 60;
      depth = "SHALLOW";
      followUp = true;
    }

    return {
      answerStatus: status,
      relevanceScore: relevance,
      correctnessScore: correctness,
      completenessScore: completeness,
      confidence: 70,
      depthLevel: depth,
      conceptsDemonstrated: [topic],
      conceptsMissing: [],
      isExplicitGap: false,
      feedbackSummary:
        status === AnswerStatus.ACCURATE
          ? "Good explanation addressing the question."
          : "Answer demonstrates basic understanding but lacks full depth.",
      followUpRecommended: followUp,
      followUpReason: followUp ? "Answer is concise; follow up for depth" : "Sufficient answer length",
      difficultyRecommendation: difficulty,
      topicContinuationRecommended: true,
    };
  }
}

export const aiAnswerAnalysisService = new AiAnswerAnalysisService();
export default aiAnswerAnalysisService;
