import { z } from "zod";
import { aiService } from "./ai.service.js";
import { getFallbackQuestion } from "./fallback-questions.js";
import { questionBankService } from "../services/question-bank.service.js";
import logger from "../../config/logger.js";

const aiQuestionResponseSchema = z.object({
  question: z.string().trim().min(5),
  concept: z.string().trim().optional().default(""),
  topic: z.string().trim().min(1),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD", "ADAPTIVE"]),
  questionType: z
    .enum([
      "TECHNICAL",
      "CONCEPTUAL",
      "PROBLEM_SOLVING",
      "BEHAVIORAL",
      "PROJECT",
      "HR",
      "INITIAL",
      "CLARIFICATION",
      "DEPTH_PROBE",
      "PRACTICAL",
      "SCENARIO",
      "VALIDATION",
    ])
    .optional()
    .default("TECHNICAL"),
  competency: z.string().optional().default("Technical Knowledge"),
});

export class AiQuestionService {
  constructor(llm = aiService) {
    this.llm = llm;
  }

  /**
   * Generates a single targeted question for the interview using AI,
   * falling back automatically to the curated fallback bank upon any failure.
   *
   * @param {Object} context
   * @param {string} context.role - Target role (e.g. "Frontend Developer")
   * @param {string} context.experienceLevel - Experience level
   * @param {string} context.topic - Target topic (e.g. "REACT")
   * @param {string} context.difficulty - Target difficulty ("EASY", "MEDIUM", "HARD")
   * @param {string[]} [context.previousQuestions=[]] - Previously asked questions in this session
   * @param {string[]} [context.conceptsAlreadyTested=[]] - Concepts already covered in this session
   * @param {string[]} [context.resumeSkills=[]] - Candidate resume skills
   * @param {string} [context.interviewType="technical"] - Interview type
   * @returns {Promise<{ question: string, concept?: string, topic: string, difficulty: string, questionType: string, competency: string }>}
   */
  async generateQuestion(context) {
    const {
      role = "Software Engineer",
      experienceLevel = "1-3 Years",
      topic = "TECHNICAL_FUNDAMENTALS",
      difficulty = "EASY",
      previousQuestions = [],
      conceptsAlreadyTested = [],
      resumeSkills = [],
      interviewId = null,
    } = context;

    const systemPrompt = `You are a professional technical interviewer for TestQ conducting an interview for the role of ${role} (${experienceLevel}).
Your task is to generate ONE single focused interview question.

STRICT RULES:
1. Topic MUST be: ${topic}.
2. Target difficulty: ${difficulty}.
3. The question must be clear, concise, and appropriate for ${experienceLevel}.
4. DO NOT test these concepts that were already tested in this session:
${conceptsAlreadyTested.filter(Boolean).map((c) => `   - ${c}`).join("\n") || "   (None yet)"}
5. DO NOT repeat or ask variations of these previously asked questions:
${previousQuestions.map((q, idx) => `   ${idx + 1}. ${q}`).join("\n") || "   (None yet)"}
6. You MUST return ONLY valid JSON matching this exact structure:
{
  "question": "Your question here",
  "concept": "Specific concept tested (e.g. event delegation, closures, indexes)",
  "topic": "${topic.toUpperCase()}",
  "difficulty": "${difficulty.toUpperCase()}",
  "questionType": "TECHNICAL",
  "competency": "Technical Knowledge"
}`;

    const userPrompt = `Generate a ${difficulty} interview question on topic "${topic}" for a ${role} candidate.
Candidate skills: ${resumeSkills.join(", ") || "Standard role skills"}.`;

    try {
      const rawAiResponse = await this.llm.generateStructuredJson({
        systemPrompt,
        userPrompt,
        meta: { interviewId, purpose: "question_gen" },
      });

      if (rawAiResponse) {
        // Normalize difficulty and topic if needed
        const normalized = {
          ...rawAiResponse,
          concept: String(rawAiResponse.concept || "").trim(),
          topic: String(rawAiResponse.topic || topic).toUpperCase(),
          difficulty: String(rawAiResponse.difficulty || difficulty).toUpperCase(),
        };

        const validated = aiQuestionResponseSchema.safeParse(normalized);
        if (validated.success) {
          logger.info(`AI generated question on topic ${topic} (${difficulty}, concept: ${validated.data.concept || "n/a"})`);
          // Persist it so a future interview can reuse it if the AI is
          // unavailable then. Non-fatal, not awaited-critically.
          await questionBankService.saveGeneratedQuestion({
            ...validated.data,
            role,
            experienceLevel,
            model: this.llm?.geminiModel || this.llm?.openaiModel || null,
          });
          return { ...validated.data, questionSource: "ai_generated" };
        } else {
          logger.warn(
            `AI response schema validation failed: ${validated.error.message}. Using fallback.`
          );
        }
      }
    } catch (err) {
      logger.warn(`AI question generation exception: ${err.message}. Using fallback.`);
    }

    // 1st fallback: a previously AI-generated question from the DB bank.
    const bankQ = await questionBankService.getBankQuestion({
      topic,
      difficulty,
      excludeQuestions: previousQuestions,
      role,
    });
    if (bankQ) return { ...bankQ, questionSource: "bank" };

    // 2nd fallback: the curated fallback set.
    logger.info(`Using verified fallback question for topic: ${topic} (${difficulty})`);
    return { ...getFallbackQuestion(topic, difficulty, previousQuestions), questionSource: "fallback" };
  }

  /**
   * Generates a single targeted follow-up question probing candidate understanding based on their actual answer.
   *
   * @param {Object} context
   * @param {string} context.role - Target role
   * @param {string} context.experienceLevel - Experience level
   * @param {string} context.topic - Current topic
   * @param {string} context.difficulty - Question difficulty
   * @param {string} context.previousQuestion - Original question asked
   * @param {string} context.candidateAnswer - Candidate's answer
   * @param {string[]} [context.previousQuestions=[]] - All questions asked in this session
   * @param {string[]} [context.conceptsDemonstrated=[]] - Concepts candidate demonstrated
   * @param {string[]} [context.conceptsMissing=[]] - Missing or shallow concepts detected
   * @returns {Promise<{ question: string, concept?: string, topic: string, difficulty: string, questionType: string, competency: string }>}
   */
  async generateFollowUpQuestion(context = {}) {
    const {
      role = "Software Engineer",
      experienceLevel = "1-3 Years",
      topic = "TECHNICAL_FUNDAMENTALS",
      difficulty = "EASY",
      previousQuestion = "",
      candidateAnswer = "",
      previousQuestions = [],
      conceptsDemonstrated = [],
      conceptsMissing = [],
      misconceptions = [],
      experienceAuthenticity = "UNPROVEN",
      contradictionDetails = null,
      followUpType = "DEPTH_PROBE",
      resumeSkills = [],
      interviewId = null,
    } = context || {};

    let targetQuestionType = "DEPTH_PROBE";
    if (followUpType === "CLARIFICATION" || followUpType === "EASY") {
      targetQuestionType = "CLARIFICATION";
    } else if (followUpType === "PRACTICAL" || followUpType === "HARD") {
      targetQuestionType = "PRACTICAL";
    } else if (followUpType === "SCENARIO") {
      targetQuestionType = "SCENARIO";
    } else if (followUpType === "VALIDATION") {
      targetQuestionType = "VALIDATION";
    }

    const missingStr =
      conceptsMissing.length > 0
        ? conceptsMissing.join(", ")
        : "practical implementation details, trade-offs, and depth";

    const misconceptionsStr =
      Array.isArray(misconceptions) && misconceptions.length > 0
        ? `\n- Identified Misconceptions to probe: ${misconceptions.join(", ")}`
        : "";

    const authenticityStr =
      experienceAuthenticity === "THEORETICAL_TEXTBOOK"
        ? "\n- Candidate gave a textbook/AI-sounding answer without hands-on context: Challenge them with a practical production/debugging scenario to test genuine project experience."
        : "";

    const contradictionStr = contradictionDetails
      ? `\n- Candidate contradiction noted: ${contradictionDetails}`
      : "";

    const resumeSkillsStr =
      Array.isArray(resumeSkills) && resumeSkills.length > 0
        ? `\n- Candidate Resume Skills: ${resumeSkills.join(", ")}`
        : "";

    const systemPrompt = `You are a professional technical interviewer for TestQ conducting an interview for the role of ${role} (${experienceLevel}).
The candidate was asked: "${previousQuestion}"
The candidate provided this answer: "${candidateAnswer}"
Evaluation Notes:
- Concepts demonstrated: ${conceptsDemonstrated.join(", ") || "Basic explanation"}
- Missing or shallow aspects: ${missingStr}${misconceptionsStr}${authenticityStr}${contradictionStr}${resumeSkillsStr}
- Probe type requested: ${targetQuestionType} (${difficulty})

Your task is to generate ONE single focused follow-up question.
STRICT RULES:
1. Ground the follow-up question directly in what the candidate said and probe deeper into:
   - Misconceptions (if candidate voiced a misconception, constructively challenge it without sounding condescending).
   - Experience Authenticity (if answer sounded textbook, ask how they implemented, debugged, or configured this in their actual project experience).
   - Missing aspects ("${missingStr}"), internal mechanics, or concrete production trade-offs.
   - If candidate introduced a relevant adjacent concept (e.g., ORM -> N+1 queries -> database indexing), controlled branching into that related concept is encouraged.
2. Question Types:
   - If CLARIFICATION: ask a constructive clarifying question addressing the core concepts they touched on.
   - If DEPTH_PROBE: probe internal mechanics, execution lifecycle, or how it works under the hood.
   - If PRACTICAL / SCENARIO: ask for real-world application, optimization, or trade-offs between alternatives.
   - If VALIDATION: present a brief concrete technical scenario to validate hands-on experience.
3. DO NOT repeat or paraphrase the original question "${previousQuestion}".
4. DO NOT repeat any of these questions previously asked in the interview:
${previousQuestions.map((q, idx) => `   ${idx + 1}. ${q}`).join("\n") || "   (None yet)"}
5. The question must be constructive, concise, direct, and conversational.
6. Target topic: ${topic}.
7. Target difficulty: ${difficulty}.
8. Return ONLY valid JSON matching this exact structure:
{
  "question": "Your targeted follow-up question here",
  "concept": "${topic.toLowerCase()} follow-up",
  "topic": "${topic.toUpperCase()}",
  "difficulty": "${difficulty.toUpperCase()}",
  "questionType": "${targetQuestionType}",
  "competency": "Technical Knowledge"
}`;

    const userPrompt = `Generate a targeted ${targetQuestionType} follow-up question probing "${missingStr}" based on what the candidate explained for "${topic}".`;

    try {
      const rawAiResponse = await this.llm.generateStructuredJson({
        systemPrompt,
        userPrompt,
        meta: { interviewId, purpose: "followup_gen" },
      });

      if (rawAiResponse) {
        const normalized = {
          ...rawAiResponse,
          concept: String(rawAiResponse.concept || `${topic.toLowerCase()} follow-up`).trim(),
          topic: String(rawAiResponse.topic || topic).toUpperCase(),
          difficulty: String(rawAiResponse.difficulty || difficulty).toUpperCase(),
          questionType: rawAiResponse.questionType || targetQuestionType,
        };

        const validated = aiQuestionResponseSchema.safeParse(normalized);
        if (validated.success) {
          logger.info(`AI generated follow-up question on topic ${topic} (type: ${validated.data.questionType}, concept: ${validated.data.concept})`);
          await questionBankService.saveGeneratedQuestion({
            ...validated.data,
            role,
            experienceLevel,
            isFollowUp: true,
            model: this.llm?.geminiModel || this.llm?.openaiModel || null,
          });
          return { ...validated.data, questionSource: "ai_generated" };
        }
      }
    } catch (err) {
      logger.warn(`AI follow-up question generation exception: ${err.message}. Using fallback.`);
    }

    // 1st fallback: a previously AI-generated follow-up from the DB bank.
    const bankQ = await questionBankService.getBankQuestion({
      topic,
      difficulty,
      excludeQuestions: [...previousQuestions, previousQuestion],
      role,
      isFollowUp: true,
    });
    if (bankQ) return { ...bankQ, questionSource: "bank" };

    // 2nd fallback: deterministic follow-up grounded in candidate answer and topic.
    const focusArea =
      conceptsMissing[0] ||
      (conceptsDemonstrated[0] ? `applying ${conceptsDemonstrated[0]}` : null) ||
      `${topic.toLowerCase()} production trade-offs and implementation details`;

    let fallbackQuestion;
    if (targetQuestionType === "CLARIFICATION") {
      fallbackQuestion = `Could you clarify how you would handle ${focusArea} in a real-world scenario?`;
    } else if (targetQuestionType === "DEPTH_PROBE") {
      fallbackQuestion = `How does ${topic} handle ${focusArea} under the hood, and what are the main architectural trade-offs?`;
    } else if (targetQuestionType === "PRACTICAL") {
      fallbackQuestion = `In a production environment, how have you configured, tested, or optimized ${focusArea}?`;
    } else if (targetQuestionType === "SCENARIO" || targetQuestionType === "VALIDATION") {
      fallbackQuestion = `Could you walk through a concrete technical problem you encountered with ${focusArea} and how you resolved it?`;
    } else {
      fallbackQuestion = `Could you elaborate on ${focusArea} and provide a concrete example from your hands-on experience?`;
    }

    return {
      question: fallbackQuestion,
      concept: `${topic.toLowerCase()} practical application`,
      topic: topic.toUpperCase(),
      difficulty: difficulty.toUpperCase(),
      questionType: targetQuestionType,
      competency: "Technical Knowledge",
      questionSource: "fallback",
    };
  }
}

export const aiQuestionService = new AiQuestionService();
export default aiQuestionService;
