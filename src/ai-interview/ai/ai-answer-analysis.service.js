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
  knowledgeLevel: z
    .enum(["NONE", "BASIC", "INTERMEDIATE", "STRONG", "EXCELLENT", "DEEP"])
    .default("INTERMEDIATE"),
  knowledgeConfidence: z.coerce.number().min(0).max(100).default(70),
  depthEstablished: z.boolean().default(false),
  evidenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
  contradictionDetected: z.boolean().default(false),
  contradictionDetails: z.string().nullable().optional().default(null),
  misconceptions: z.array(z.string()).default([]),
  experienceAuthenticity: z
    .enum(["THEORETICAL_TEXTBOOK", "SURFACE_FAMILIARITY", "PRODUCTION_VERIFIED", "UNPROVEN"])
    .default("UNPROVEN"),
  practicalUnderstanding: z
    .enum(["NONE", "BASIC", "ADEQUATE", "DEEP"])
    .default("ADEQUATE"),
  conceptsDemonstrated: z.array(z.string()).default([]),
  conceptsMissing: z.array(z.string()).default([]),
  isExplicitGap: z.boolean().default(false),
  feedbackSummary: z.string().default("Candidate response analyzed."),
  followUpRecommended: z.boolean().default(false),
  followUpReason: z.string().optional().default(""),
  followUpType: z
    .enum([
      "EASY",
      "MEDIUM",
      "HARD",
      "SCENARIO",
      "VALIDATION",
      "CLARIFICATION",
      "DEPTH_PROBE",
      "PRACTICAL",
      "NONE",
    ])
    .default("NONE"),
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
   * @param {Array} [params.previousTurns=[]] - Previous Q&A turns in session for contradiction detection
   * @returns {Promise<Object>} Validated structured analysis
   */
  async analyzeCandidateAnswer({
    question,
    candidateAnswer,
    topic,
    difficulty,
    role = "Software Engineer",
    experienceLevel = "1-3 Years",
    previousTurns = [],
    interviewId = null,
  }) {
    const systemPrompt = `You are an expert technical interviewer for TestQ evaluating a candidate's answer for the role of ${role} (${experienceLevel}).

STRICT TASK:
Analyze the candidate's answer for the question asked.
Assess technical correctness, relevance, completeness, depth, practical understanding, contradictions, misconceptions, and experience authenticity.

STRICT JSON OUTPUT FORMAT:
{
  "answerStatus": "ACCURATE" | "PARTIAL" | "KNOWLEDGE_GAP" | "INCORRECT" | "SKIPPED",
  "relevanceScore": 0-100,
  "correctnessScore": 0-100,
  "completenessScore": 0-100,
  "confidence": 0-100,
  "depthLevel": "SHALLOW" | "ADEQUATE" | "DEEP",
  "knowledgeLevel": "NONE" | "BASIC" | "INTERMEDIATE" | "STRONG" | "EXCELLENT",
  "knowledgeConfidence": 0-100,
  "depthEstablished": true | false,
  "evidenceLevel": "LOW" | "MEDIUM" | "HIGH",
  "contradictionDetected": true | false,
  "contradictionDetails": "Explanation if candidate contradicted an earlier answer" | null,
  "misconceptions": ["List of any technical misconceptions voiced by candidate"],
  "experienceAuthenticity": "THEORETICAL_TEXTBOOK" | "SURFACE_FAMILIARITY" | "PRODUCTION_VERIFIED" | "UNPROVEN",
  "practicalUnderstanding": "NONE" | "BASIC" | "ADEQUATE" | "DEEP",
  "conceptsDemonstrated": ["concept1", "concept2"],
  "conceptsMissing": ["concept3"],
  "isExplicitGap": false,
  "feedbackSummary": "Brief constructive technical feedback",
  "followUpRecommended": true | false,
  "followUpReason": "Why a follow-up should or should not be asked",
  "followUpType": "EASY" | "MEDIUM" | "HARD" | "SCENARIO" | "VALIDATION" | "CLARIFICATION" | "DEPTH_PROBE" | "PRACTICAL" | "NONE",
  "difficultyRecommendation": "EASY" | "MEDIUM" | "HARD" | null,
  "topicContinuationRecommended": true | false
}

CRITICAL INTERVIEWER RULES:
1. SEPARATE KNOWLEDGE SCORE FROM DEPTH:
   - A candidate reciting a textbook definition may score 90-95% on correctness, BUT depthLevel is "SHALLOW", experienceAuthenticity is "THEORETICAL_TEXTBOOK", and depthEstablished is FALSE!
   - In that case, set followUpRecommended: true and followUpType: "VALIDATION" or "PRACTICAL" (e.g. ask for trade-offs, internal mechanics, or failure handling).
   - depthEstablished is TRUE ONLY when:
     * The candidate provides concrete deep technical mechanisms and trade-offs ("DEEP" depth), OR
     * The candidate has successfully passed a targeted validation/practical follow-up probe.
2. CONTRADICTION & MISCONCEPTION DETECTION:
   - Compare with Previous Answers provided in the prompt.
   - If candidate makes a claim contradicting an earlier answer (e.g., previously stated indexes improve queries, but now claims indexes have zero overhead on inserts/updates), set contradictionDetected: true and add the misconception to "misconceptions".
   - Set followUpRecommended: true, followUpType: "DEPTH_PROBE".
3. EVIDENCE LEVEL:
   - "LOW": 1 answer or high-level theoretical statement without deep verification.
   - "MEDIUM": Demonstrated clear grasp across 2 questions or solid explanation.
   - "HIGH": Multiple turns showing deep practical understanding, internal mechanics, and real-world trade-offs.
4. EXPERIENCE AUTHENTICITY:
   - "THEORETICAL_TEXTBOOK": Generic textbook or AI-generated definition without production battle-testing.
   - "SURFACE_FAMILIARITY": Buzzword awareness, but stumbles on how it actually works.
   - "PRODUCTION_VERIFIED": Mentions real-world debugging, query plans, concurrency, failure cases, or operational trade-offs.
5. FOLLOW-UP TYPES:
   - "CLARIFICATION": Basic answer lacking clarity or missing foundational definition.
   - "DEPTH_PROBE": Missing internal mechanism or technical nuance (e.g. from conceptsMissing).
   - "PRACTICAL": Testing real implementation code or query optimization.
   - "SCENARIO": High-level trade-off or architectural dilemma.
   - "VALIDATION": High score (>90) but textbook answer; ask a quick scenario to verify genuine hands-on depth.
   - "NONE": When depthEstablished is true or knowledgeLevel is "NONE".
6. Return ONLY valid JSON matching the format.`;

    let userPrompt = `Question: "${question}"
Topic: "${topic}"
Difficulty: "${difficulty}"
Candidate Answer: "${candidateAnswer}"`;

    if (Array.isArray(previousTurns) && previousTurns.length > 0) {
      const prevTurnsSummary = previousTurns
        .filter((t) => t.question && t.candidateAnswer)
        .map((t, idx) => `[Turn ${idx + 1}] Q: "${t.question}" -> A: "${t.candidateAnswer}"`)
        .join("\n");
      if (prevTurnsSummary) {
        userPrompt += `\n\nPrevious Session Turns (check for contradictions):\n${prevTurnsSummary}`;
      }
    }

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
      depth = "ADEQUATE";
      followUp = true; // Foundational textbook answer: probe practical depth
    } else {
      // Moderate length answer (4-24 words)
      status = AnswerStatus.PARTIAL;
      correctness = 65;
      completeness = 60;
      depth = "SHALLOW";
      followUp = true;
    }

    let knowledgeLevel = "INTERMEDIATE";
    let depthEstablished = false;
    let practicalUnderstanding = "ADEQUATE";
    let followUpType = "NONE";

    let evidenceLevel = "LOW";
    let experienceAuthenticity = "UNPROVEN";

    if (status === AnswerStatus.ACCURATE) {
      if (depth === "DEEP") {
        knowledgeLevel = "STRONG";
        depthEstablished = true;
        evidenceLevel = "MEDIUM";
        practicalUnderstanding = "DEEP";
        experienceAuthenticity = "PRODUCTION_VERIFIED";
        followUpType = "NONE";
      } else {
        knowledgeLevel = "INTERMEDIATE";
        depthEstablished = false;
        evidenceLevel = "LOW";
        practicalUnderstanding = "ADEQUATE";
        experienceAuthenticity = "THEORETICAL_TEXTBOOK";
        followUpType = "PRACTICAL";
      }
    } else if (status === AnswerStatus.PARTIAL) {
      knowledgeLevel = "INTERMEDIATE";
      depthEstablished = false;
      evidenceLevel = "LOW";
      practicalUnderstanding = "BASIC";
      experienceAuthenticity = "SURFACE_FAMILIARITY";
      followUpType = "DEPTH_PROBE";
    } else if (status === AnswerStatus.INCORRECT) {
      knowledgeLevel = "BASIC";
      depthEstablished = false;
      evidenceLevel = "LOW";
      practicalUnderstanding = "NONE";
      experienceAuthenticity = "UNPROVEN";
      followUpType = "NONE";
    }

    return {
      answerStatus: status,
      relevanceScore: relevance,
      correctnessScore: correctness,
      completenessScore: completeness,
      confidence: 70,
      depthLevel: depth,
      knowledgeLevel,
      knowledgeConfidence: 70,
      depthEstablished,
      evidenceLevel,
      contradictionDetected: false,
      contradictionDetails: null,
      misconceptions: [],
      experienceAuthenticity,
      practicalUnderstanding,
      conceptsDemonstrated: [topic],
      conceptsMissing: [],
      isExplicitGap: false,
      feedbackSummary:
        status === AnswerStatus.ACCURATE
          ? "Good explanation addressing the question."
          : "Answer demonstrates basic understanding but lacks full depth.",
      followUpRecommended: followUp,
      followUpReason: followUp ? "Answer is concise; follow up for depth" : "Sufficient answer length",
      followUpType,
      difficultyRecommendation: difficulty,
      topicContinuationRecommended: true,
    };
  }
}

export const aiAnswerAnalysisService = new AiAnswerAnalysisService();
export default aiAnswerAnalysisService;
