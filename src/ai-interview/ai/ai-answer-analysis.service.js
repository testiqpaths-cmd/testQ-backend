import { z } from "zod";
import { aiService } from "./ai.service.js";
import { AnswerStatus } from "../enums/answer-status.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";
import { interviewStateBuilderService } from "../services/interview-state-builder.service.js";
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
  evaluationSource: z.enum(["AI", "FALLBACK"]).default("AI"),
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
   * @param {Object} [params.interviewState=null] - Compact interview state from InterviewStateBuilder
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
    interviewState = null,
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
1. COMPLETE & ACCURATE VS SHALLOW (100% accurate != automatically complete):
   - Example shallow: Question: "How does Redis handle persistence?" -> Candidate: "Redis supports RDB and AOF persistence."
     This is accurate, but shallow/incomplete (omits mechanics and trade-offs).
     In that case: depthLevel: "SHALLOW", completenessScore: 50-65, followUpRecommended: true, followUpType: "VALIDATION" or "PRACTICAL".
   - Example complete: Candidate explains RDB snapshots (point-in-time, fast restore, compact) vs AOF (append-only log, durability, fsync policies like always/everysec/no, performance vs durability trade-offs).
     This answer is correct AND complete AND sufficiently detailed.
     In that case: followUpRecommended: false, followUpType: "NONE", depthEstablished: true, depthLevel: "DEEP", completenessScore: >= 85.
     DO NOT ask a cross-question just for the sake of asking one! Accept answer and advance.
   - Cross-question depth should NEVER be triggered merely because the candidate answered correctly.

2. RECOMMENDED DECISION LOGIC MATRIX:
   - 90–100% + complete & detailed: followUpRecommended: false, followUpType: "NONE", depthEstablished: true. Accept answer and move to next topic/question.
   - 80–90%: followUpRecommended: true, followUpType: "PRACTICAL" or "VALIDATION". Ask 1 meaningful cross-question to validate depth.
   - 60–80%: followUpRecommended: true, followUpType: "DEPTH_PROBE" or "PRACTICAL". Ask follow-up/cross-question on missing details or mechanisms.
   - 40–60%: followUpRecommended: true, followUpType: "CLARIFICATION". Clarify fundamentals before reassessing.
   - <40% (or incorrect): followUpRecommended: false, followUpType: "NONE". Don't waste multiple cross-questions; move to another question.
   - Correct but shallow: followUpRecommended: true, followUpType: "VALIDATION" or "PRACTICAL", depthEstablished: false.
   - Correct but missing important detail: followUpRecommended: true, followUpType: "DEPTH_PROBE", populate conceptsMissing.

3. CONTRADICTION & MISCONCEPTION DETECTION:
   - Compare with Previous Answers or Structured Interview Evidence provided in the prompt.
   - Cross-reference against Verified Concepts, Known Misconceptions, and Resume Claims.
   - If candidate makes a claim contradicting an earlier answer or verified evidence (e.g., previously stated indexes improve queries, but now claims indexes have zero overhead on inserts/updates), set contradictionDetected: true and add the misconception to "misconceptions".
   - Set followUpRecommended: true, followUpType: "DEPTH_PROBE".

4. EVIDENCE LEVEL:
   - "LOW": 1 answer or high-level theoretical statement without deep verification.
   - "MEDIUM": Demonstrated clear grasp across 2 questions or solid explanation with mechanisms.
   - "HIGH": Multiple turns showing deep practical understanding, internal mechanics, and real-world trade-offs.

5. EXPERIENCE AUTHENTICITY:
   - "THEORETICAL_TEXTBOOK": Generic textbook or AI-generated definition without production battle-testing.
   - "SURFACE_FAMILIARITY": Buzzword awareness, but stumbles on how it actually works.
   - "PRODUCTION_VERIFIED": Mentions real-world debugging, query plans, concurrency, failure cases, fsync, or operational trade-offs.

6. FOLLOW-UP TYPES:
   - "CLARIFICATION": Basic answer (40-60%) lacking clarity or missing foundational definition.
   - "DEPTH_PROBE": Missing internal mechanism or technical nuance (e.g. from conceptsMissing).
   - "PRACTICAL": Testing real implementation code, trade-offs, or optimization (80-90% or strong).
   - "SCENARIO": High-level trade-off or architectural dilemma.
   - "VALIDATION": High score (>90) but shallow textbook answer; ask a quick scenario to verify genuine hands-on depth.
   - "NONE": When answer is correct AND complete, depthEstablished is true, or score < 40%.
7. Return ONLY valid JSON matching the format.`;

    let userPrompt = `Question: "${question}"
Topic: "${topic}"
Difficulty: "${difficulty}"
Candidate Answer: "${candidateAnswer}"`;

    const compactEvaluatorEnabled = process.env.COMPACT_EVALUATOR_ENABLED !== "false";

    if (compactEvaluatorEnabled) {
      // Sprint 5 Compact Prompt Path
      const stateToFormat =
        interviewState ||
        (Array.isArray(previousTurns) && previousTurns.length > 0
          ? interviewStateBuilderService.buildState({}, previousTurns, { question, topic, difficulty })
          : null);

      if (stateToFormat && stateToFormat.totalTurnsCompleted > 0) {
        const compactBlock = interviewStateBuilderService.formatStateForPrompt(stateToFormat);
        if (compactBlock) {
          userPrompt += `\n\n${compactBlock}`;
        }
      }
    } else {
      // Legacy Full History Path (Feature Flag Fallback)
      if (Array.isArray(previousTurns) && previousTurns.length > 0) {
        const prevTurnsSummary = previousTurns
          .filter((t) => t.question && t.candidateAnswer)
          .map((t, idx) => `[Turn ${idx + 1}] Q: "${t.question}" -> A: "${t.candidateAnswer}"`)
          .join("\n");
        if (prevTurnsSummary) {
          userPrompt += `\n\nPrevious Session Turns (check for contradictions):\n${prevTurnsSummary}`;
        }
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
    const isVeryEmpty =
      wordCount === 0 ||
      /^(?:\(?skipped\)?|skip|pass|no\s+idea|don'?t\s+know|n\/?a)$/i.test(text);

    // PRINCIPLED FALLBACK: When LLM evaluation is unavailable, do NOT pretend
    // to know factual correctness based on superficial word count.
    // Instead, assign a conservative baseline status with low confidence,
    // explicitly tag evaluationSource as "FALLBACK", and avoid aggressive adaptive probes.
    return {
      answerStatus: isVeryEmpty ? AnswerStatus.SKIPPED : AnswerStatus.PARTIAL,
      relevanceScore: isVeryEmpty ? 0 : 50,
      correctnessScore: isVeryEmpty ? 0 : 50,
      completenessScore: isVeryEmpty ? 0 : 50,
      confidence: 20, // Low confidence: unverified heuristic
      depthLevel: "ADEQUATE",
      knowledgeLevel: "INTERMEDIATE",
      knowledgeConfidence: 20,
      depthEstablished: false,
      evidenceLevel: "LOW",
      contradictionDetected: false,
      contradictionDetails: null,
      misconceptions: [],
      experienceAuthenticity: "UNPROVEN",
      practicalUnderstanding: "ADEQUATE",
      conceptsDemonstrated: [topic],
      conceptsMissing: [],
      isExplicitGap: false,
      feedbackSummary: isVeryEmpty
        ? "No answer recorded before timeout."
        : "Candidate answer recorded. System evaluated under conservative fallback mode; proceeding with interview plan.",
      followUpRecommended: false, // Never make aggressive follow-up decisions when evaluation is uncertain
      followUpReason: "FALLBACK_UNCERTAIN",
      followUpType: "NONE",
      difficultyRecommendation: difficulty,
      topicContinuationRecommended: true,
      evaluationSource: "FALLBACK",
    };
  }
}

export const aiAnswerAnalysisService = new AiAnswerAnalysisService();
export default aiAnswerAnalysisService;
