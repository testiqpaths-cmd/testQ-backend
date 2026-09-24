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
    .enum(["TECHNICAL", "CONCEPTUAL", "PROBLEM_SOLVING", "BEHAVIORAL", "PROJECT", "HR"])
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
  async generateFollowUpQuestion(context) {
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
      interviewId = null,
    } = context;

    const missingStr =
      conceptsMissing.length > 0
        ? conceptsMissing.join(", ")
        : "practical implementation details and depth";

    const systemPrompt = `You are a professional technical interviewer for TestQ conducting an interview for the role of ${role} (${experienceLevel}).
The candidate was asked: "${previousQuestion}"
The candidate provided this answer: "${candidateAnswer}"
Evaluation Notes:
- Concepts demonstrated: ${conceptsDemonstrated.join(", ") || "Basic explanation"}
- Missing or shallow aspects: ${missingStr}

Your task is to generate ONE single focused follow-up question.
STRICT RULES:
1. Ground the follow-up question directly in what the candidate said and probe deeper into the missing aspects, practical implementation details, trade-offs, or a concrete example.
2. DO NOT repeat or paraphrase the original question "${previousQuestion}".
3. DO NOT repeat any of these questions previously asked in the interview:
${previousQuestions.map((q, idx) => `   ${idx + 1}. ${q}`).join("\n") || "   (None yet)"}
4. The question must be constructive, concise, direct, and conversational.
5. Target topic: ${topic}.
6. Target difficulty: ${difficulty}.
7. Return ONLY valid JSON matching this exact structure:
{
  "question": "Your targeted follow-up question here",
  "concept": "${topic.toLowerCase()} follow-up",
  "topic": "${topic.toUpperCase()}",
  "difficulty": "${difficulty.toUpperCase()}",
  "questionType": "TECHNICAL",
  "competency": "Technical Knowledge"
}`;

    const userPrompt = `Generate a targeted follow-up question probing "${missingStr}" based on what the candidate explained for "${topic}".`;

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
        };

        const validated = aiQuestionResponseSchema.safeParse(normalized);
        if (validated.success) {
          logger.info(`AI generated follow-up question on topic ${topic} (concept: ${validated.data.concept})`);
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

    // 2nd fallback: deterministic follow-up grounded in candidate answer.
    const focusArea = conceptsMissing[0] || "its practical application";
    return {
      question: `Could you elaborate more on ${focusArea} and give a concrete example from your experience?`,
      concept: `${topic.toLowerCase()} practical application`,
      topic: topic.toUpperCase(),
      difficulty: difficulty.toUpperCase(),
      questionType: "TECHNICAL",
      competency: "Technical Knowledge",
      questionSource: "fallback",
    };
  }
}

export const aiQuestionService = new AiQuestionService();
export default aiQuestionService;
