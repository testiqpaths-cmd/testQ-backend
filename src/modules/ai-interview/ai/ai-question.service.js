import { z } from "zod";
import { aiService } from "./ai.service.js";
import { getFallbackQuestion } from "./fallback-questions.js";
import { questionBankService } from "../services/question-bank.service.js";
import { resolveInterviewTypeForTopic, getTypePersonaAndConfig } from "../constants/interview-types.js";
import {
  QUESTION_CATEGORIES,
  CATEGORY_QUESTION_TYPE,
  categoryAllowsProjectContext,
  categoryUsesWorkHistory,
  topicLabel,
} from "../constants/interview-phases.js";
import { describeBandForPrompt } from "../constants/experience-bands.js";
import logger from "../../../config/logger.js";

/**
 * Per-category instructions. Each tells the model what this question is
 * for and, crucially, whether resume projects belong in it at all.
 */
export const CATEGORY_INSTRUCTIONS = Object.freeze({
  [QUESTION_CATEGORIES.EXPERIENCE]:
    "Understand the candidate's professional experience: responsibilities, technologies used at work, their actual contribution, level of ownership and how long they did it. If work history is provided, ask about one specific role from it. Do not quiz technical concepts and do not ask about resume projects here.",
  [QUESTION_CATEGORIES.TECHNICAL_CONCEPT]:
    "Evaluate the candidate's actual technical understanding. Ask a standalone technical question about concepts, internals or how something works. Do not mention resume projects or force the question into a project scenario.",
  [QUESTION_CATEGORIES.TECHNICAL_IMPLEMENTATION]:
    "Evaluate implementation knowledge: how the technology is applied, its internals, debugging, performance and trade-offs. Ask a standalone technical question. Do not mention resume projects or force the question into a project scenario.",
  [QUESTION_CATEGORIES.PROJECT_DEEP_DIVE]:
    "Evaluate the candidate's practical experience and ownership. Use only project information supported by the resume. Ask one focused question about implementation, architecture, technology choices, challenges, data design, security, performance or trade-offs, and about what the candidate personally did. Never invent details, metrics or technologies the resume does not state.",
  [QUESTION_CATEGORIES.SCENARIO_BASED]:
    "Present a realistic technical situation for this role (for example a slow endpoint, unexpected re-renders, a database slowing under load) and evaluate the candidate's problem-solving approach. Describe the situation in the question itself; do not reference the candidate's resume projects.",
  [QUESTION_CATEGORIES.BEHAVIORAL]:
    "Evaluate ownership, decision-making, independent problem-solving and technical responsibility through a specific past situation. Ask for what they did, why, and the outcome.",
  [QUESTION_CATEGORIES.CLOSING]:
    "Close the interview naturally with one short reflective question.",
});

const RECENT_ANSWER_CHARS = 200;

function formatWorkHistory(workHistory) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) return "";
  const lines = workHistory.map((w) => {
    const head = [w.role, w.company && `at ${w.company}`, w.duration && `(${w.duration})`].filter(Boolean).join(" ");
    const tech = w.technologies?.length ? `; technologies: ${w.technologies.join(", ")}` : "";
    const resp = w.responsibilities?.length ? `; e.g. "${w.responsibilities[0]}"` : "";
    return `- ${head}${tech}${resp}`;
  });
  return `\nCandidate Work History (from resume):\n${lines.join("\n")}`;
}

function formatRecentAnswers(recentAnswers) {
  if (!Array.isArray(recentAnswers) || recentAnswers.length === 0) return "";
  const lines = recentAnswers
    .filter((a) => a && a.answer)
    .slice(-2)
    .map((a) => `- Q: ${String(a.question || "").slice(0, 120)}\n  A: ${String(a.answer).slice(0, RECENT_ANSWER_CHARS)}`);
  return lines.length ? `\nRecent candidate answers (for continuity; do not repeat these questions):\n${lines.join("\n")}` : "";
}

function formatProject(projectContext) {
  if (!projectContext || typeof projectContext !== "object") return "";
  const parts = [];
  if (projectContext.title) parts.push(`- Project: ${projectContext.title}`);
  if (projectContext.description) parts.push(`- Description: ${projectContext.description}`);
  if (projectContext.technologies?.length) parts.push(`- Technologies: ${projectContext.technologies.join(", ")}`);
  if (projectContext.architecture) parts.push(`- Architecture: ${projectContext.architecture}`);
  if (projectContext.contributions?.length) parts.push(`- Claimed Contributions: ${projectContext.contributions.join("; ")}`);
  if (projectContext.evidenceSnippet) parts.push(`- Resume Evidence: "${projectContext.evidenceSnippet}"`);
  return parts.length ? `\nCandidate Claimed Project Context:\n${parts.join("\n")}` : "";
}

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
      projectContext = null,
      interviewType = "technical",
      interviewId = null,
      questionCategory = null,
      phase = null,
      experienceProfile = null,
      workHistory = null,
      recentAnswers = [],
    } = context || {};

    const resolvedType = resolveInterviewTypeForTopic(topic, [interviewType]);
    const typeConfig = getTypePersonaAndConfig(resolvedType, role, experienceLevel);

    // Without a category (older callers) keep the previous behaviour:
    // project grounding when a project is supplied.
    const category = questionCategory || null;
    const projectAllowed = category ? categoryAllowsProjectContext(category) : Boolean(projectContext);
    const projectContextPrompt = projectAllowed ? formatProject(projectContext) : "";
    // Project questions for candidates whose resume lists jobs but no
    // projects fall back to work history as their evidence.
    const workHistoryPrompt =
      category &&
      (categoryUsesWorkHistory(category) ||
        (category === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE && !projectContextPrompt))
        ? formatWorkHistory(workHistory)
        : "";
    const recentAnswersPrompt =
      category && category !== QUESTION_CATEGORIES.TECHNICAL_CONCEPT ? formatRecentAnswers(recentAnswers) : "";
    const bandPrompt = describeBandForPrompt(experienceProfile);
    const questionType =
      (category && CATEGORY_QUESTION_TYPE[category]) || typeConfig.defaultQuestionType;
    const label = topicLabel(topic);

    const groundingRule = category
      ? `8. Question category: ${category}${phase ? ` (interview phase: ${phase})` : ""}. ${CATEGORY_INSTRUCTIONS[category] || CATEGORY_INSTRUCTIONS[QUESTION_CATEGORIES.TECHNICAL_CONCEPT]}`
      : "8. If candidate claimed project context is provided, GROUND the question in what the candidate explicitly claims to have built or contributed, WITHOUT assuming or fabricating unstated implementation details, metrics, or frameworks. Ask about their claimed contribution, design trade-offs, architecture decisions, or implementation choices based strictly on what is stated. If no project is provided, ground the question in their claimed skills.";

    const systemPrompt = `${typeConfig.persona}
${typeConfig.goal}
Your task is to generate ONE single focused interview question.
${bandPrompt ? `\n${bandPrompt}\nPitch the question at this level and the requested difficulty: the same topic is asked differently of a fresher and of a senior engineer.\n` : ""}
STRICT RULES:
1. Topic MUST be: ${label} (key: ${topic}).
2. Target difficulty: ${difficulty}.
3. The question must be clear, concise, direct, and appropriate for ${experienceLevel}.
4. Target competency: ${typeConfig.defaultCompetency}.
5. Focus areas: ${typeConfig.focusSummary}.
6. DO NOT test these concepts that were already tested in this session:
${conceptsAlreadyTested.filter(Boolean).map((c) => `   - ${c}`).join("\n") || "   (None yet)"}
7. DO NOT repeat or ask variations of these previously asked questions:
${previousQuestions.map((q, idx) => `   ${idx + 1}. ${q}`).join("\n") || "   (None yet)"}
${groundingRule}
9. You MUST return ONLY valid JSON matching this exact structure:
{
  "question": "Your question here",
  "concept": "Specific concept tested (e.g. STAR leadership, event delegation, system scalability)",
  "topic": "${topic.toUpperCase()}",
  "difficulty": "${difficulty.toUpperCase()}",
  "questionType": "${questionType}",
  "competency": "${typeConfig.defaultCompetency}"
}`;

    const skillsLine =
      category === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE || category === QUESTION_CATEGORIES.EXPERIENCE
        ? ""
        : `\nCandidate background / skills: ${resumeSkills.join(", ") || "Standard role background"}.`;
    const userPrompt = `Generate a ${difficulty} ${(category || resolvedType).toUpperCase()} interview question on "${label}" for a ${role} candidate (${experienceLevel}).${skillsLine}${projectContextPrompt ? `\n${projectContextPrompt}` : ""}${workHistoryPrompt}${recentAnswersPrompt}`;

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
          // The planner owns the topic: a different topic from the model
          // would silently move the session to another topic or phase.
          topic: String(topic).toUpperCase(),
          difficulty: String(rawAiResponse.difficulty || difficulty).toUpperCase(),
          questionType: category ? questionType : rawAiResponse.questionType || typeConfig.defaultQuestionType,
          competency: rawAiResponse.competency || typeConfig.defaultCompetency,
        };

        const validated = aiQuestionResponseSchema.safeParse(normalized);
        if (validated.success) {
          logger.info(`AI generated question on topic ${topic} (${difficulty}, type: ${validated.data.questionType}, concept: ${validated.data.concept || "n/a"})`);
          // Persist it so a future interview can reuse it if the AI is
          // unavailable then. Non-fatal, not awaited-critically.
          await questionBankService.saveGeneratedQuestion({
            ...validated.data,
            role,
            experienceLevel,
            model: this.llm?.geminiModel || this.llm?.openaiModel || null,
          });
          return { ...validated.data, questionCategory: category, questionSource: "ai_generated" };
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
    if (bankQ) {
      return {
        ...bankQ,
        topic: String(topic).toUpperCase(),
        questionType: category ? questionType : bankQ.questionType || typeConfig.defaultQuestionType,
        competency: bankQ.competency || typeConfig.defaultCompetency,
        questionCategory: category,
        questionSource: "bank",
      };
    }

    // 2nd fallback: the curated fallback set matching topic & interview type.
    logger.info(`Using verified fallback question for topic: ${topic} (${difficulty}, type: ${resolvedType})`);
    const curated = getFallbackQuestion(topic, difficulty, previousQuestions, resolvedType);
    return {
      ...curated,
      ...(category ? { questionType } : {}),
      questionCategory: category,
      questionSource: "fallback",
    };
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
   * @param {string} [context.interviewType="technical"] - Interview type
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
      projectContext = null,
      interviewType = "technical",
      interviewId = null,
      phase = null,
      questionCategory = null,
      experienceProfile = null,
    } = context || {};

    const resolvedType = resolveInterviewTypeForTopic(topic, [interviewType]);
    const typeConfig = getTypePersonaAndConfig(resolvedType, role, experienceLevel);
    const label = topicLabel(topic);
    // A follow-up may reference a project only when its parent question was
    // a project question. Older callers (no category) keep prior behaviour.
    const projectAllowed = questionCategory
      ? categoryAllowsProjectContext(questionCategory)
      : Boolean(projectContext);
    const isTechnicalCategory =
      questionCategory === QUESTION_CATEGORIES.TECHNICAL_CONCEPT ||
      questionCategory === QUESTION_CATEGORIES.TECHNICAL_IMPLEMENTATION;
    const projectTitle = projectAllowed && projectContext?.title ? projectContext.title : null;

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
        : resolvedType === "hr" || resolvedType === "behavioral"
        ? "specific actions taken, measurable outcomes, or lessons learned"
        : "practical implementation details, trade-offs, and depth";

    const misconceptionsStr =
      Array.isArray(misconceptions) && misconceptions.length > 0
        ? `\n- Identified Misconceptions to probe: ${misconceptions.join(", ")}`
        : "";

    const authenticityStr =
      experienceAuthenticity === "THEORETICAL_TEXTBOOK"
        ? resolvedType === "hr" || resolvedType === "behavioral"
          ? "\n- Candidate gave a generic/theoretical answer without concrete personal context: Ask for a specific real-world example from their actual experience."
          : !questionCategory
          ? `\n- Candidate gave a textbook/AI-sounding answer without hands-on context: Challenge them with a practical production/debugging scenario from their claimed project context (${projectContext?.title ? `'${projectContext.title}'` : "hands-on experience"}).`
          : projectTitle
          ? `\n- Candidate gave a textbook/AI-sounding answer without hands-on context: Challenge them with a practical production/debugging scenario from their claimed project context ('${projectTitle}').`
          : `\n- Candidate gave a textbook/AI-sounding answer without hands-on context: Challenge them with a practical production/debugging scenario about ${label} itself, without referring to their resume projects.`
        : "";

    const contradictionStr = contradictionDetails
      ? `\n- Candidate contradiction noted: ${contradictionDetails}`
      : "";

    const resumeSkillsStr =
      Array.isArray(resumeSkills) && resumeSkills.length > 0
        ? `\n- Candidate Background: ${resumeSkills.join(", ")}`
        : "";

    const projectContextStr = projectTitle
      ? `\n- Candidate Project: ${projectTitle} (${(projectContext.technologies || []).join(", ")})`
      : "";

    const PHASE_FOLLOW_UP_GUIDANCE = {
      [QUESTION_CATEGORIES.TECHNICAL_CONCEPT]:
        "Go deeper into the same concept: mechanics, implementation details or debugging. Do not switch to the candidate's projects.",
      [QUESTION_CATEGORIES.TECHNICAL_IMPLEMENTATION]:
        "Go deeper into implementation, internals, performance or failure handling of the same technology. Do not switch to the candidate's projects.",
      [QUESTION_CATEGORIES.PROJECT_DEEP_DIVE]:
        "Probe the same project: architecture, the candidate's own contribution, technical decisions and challenges. Verify ownership without inventing details.",
      [QUESTION_CATEGORIES.SCENARIO_BASED]:
        "Extend the same scenario: further troubleshooting steps, what they would check next, or how they would redesign to prevent it.",
      [QUESTION_CATEGORIES.EXPERIENCE]:
        "Ask for specifics of the same role: their exact responsibilities, decisions and outcomes.",
      [QUESTION_CATEGORIES.BEHAVIORAL]:
        "Ask for specifics of the same situation: their actions, reasoning and the result.",
    };
    const phaseRule = questionCategory
      ? `\n0. Stay in the current interview phase${phase ? ` (${phase})` : ""} and on the same topic (${label}). ${PHASE_FOLLOW_UP_GUIDANCE[questionCategory] || ""} You may make it easier or harder, but do not move to a different topic or phase.`
      : "";
    const bandPrompt = describeBandForPrompt(experienceProfile);

    const systemPrompt = `${typeConfig.persona}
The candidate was asked: "${previousQuestion}"
The candidate provided this answer: "${candidateAnswer}"
Evaluation Notes:
- Concepts demonstrated: ${conceptsDemonstrated.join(", ") || "Basic explanation"}
- Missing or shallow aspects: ${missingStr}${misconceptionsStr}${authenticityStr}${contradictionStr}${resumeSkillsStr}${projectContextStr}
- Probe type requested: ${targetQuestionType} (${difficulty})
- Interview format: ${resolvedType} (${typeConfig.focusSummary})

${bandPrompt ? `${bandPrompt}\n` : ""}
Your task is to generate ONE single focused follow-up question.
STRICT RULES:${phaseRule}
1. Ground the follow-up question directly in what the candidate said and probe deeper into:
   - For HR / Behavioral: probe the STAR framework (specific actions, team dynamics, measurable impact, or what they would do differently).
   - For Technical / System Design / Coding: probe mechanics, failure handling, scalability trade-offs, or hands-on implementation details.
   - If candidate voiced a misconception, constructively challenge it without sounding condescending.
   - If answer sounded textbook, ${projectTitle ? `ask how they handled this in their actual project (specifically in '${projectTitle}')` : isTechnicalCategory ? "ask a concrete implementation or debugging question about the same concept" : "ask how they handled this in their actual workplace experience"}.
2. Question Types:
   - If CLARIFICATION: ask a constructive clarifying question addressing the core concepts they touched on.
   - If DEPTH_PROBE: probe internal mechanics, execution details, or specific decision steps.
   - If PRACTICAL / SCENARIO: ask for real-world application, optimization, or trade-offs between alternatives.
   - If VALIDATION: present a brief concrete scenario to validate hands-on experience.
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
  "competency": "${typeConfig.defaultCompetency}"
}`;

    const userPrompt = `Generate a targeted ${targetQuestionType} follow-up question probing "${missingStr}" based on what the candidate explained for "${topic}" in this ${resolvedType} interview.`;

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
          // Follow-ups never change topic, so they can never change phase.
          topic: String(topic).toUpperCase(),
          difficulty: String(rawAiResponse.difficulty || difficulty).toUpperCase(),
          questionType: rawAiResponse.questionType || targetQuestionType,
          competency: rawAiResponse.competency || typeConfig.defaultCompetency,
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
    if (bankQ) {
      return {
        ...bankQ,
        questionType: bankQ.questionType || targetQuestionType,
        competency: bankQ.competency || typeConfig.defaultCompetency,
        questionSource: "bank",
      };
    }

    // 2nd fallback: deterministic follow-up grounded in candidate answer, topic, and interview type.
    const focusArea =
      conceptsMissing[0] ||
      (conceptsDemonstrated[0] ? `applying ${conceptsDemonstrated[0]}` : null) ||
      (resolvedType === "hr" || resolvedType === "behavioral"
        ? `your specific actions and the measurable result`
        : `${label} trade-offs and implementation details`);

    let fallbackQuestion;
    if (resolvedType === "hr" || resolvedType === "behavioral") {
      if (targetQuestionType === "CLARIFICATION") {
        fallbackQuestion = `Could you share a specific situation that illustrates ${focusArea}?`;
      } else if (targetQuestionType === "DEPTH_PROBE") {
        fallbackQuestion = `In that situation, what was your specific role and what was the outcome of your actions?`;
      } else if (targetQuestionType === "PRACTICAL") {
        fallbackQuestion = `If you faced a similar challenge again today, what would you do differently regarding ${focusArea}?`;
      } else {
        fallbackQuestion = `Could you elaborate on the impact your approach had on the team and project regarding ${focusArea}?`;
      }
    } else {
      if (targetQuestionType === "CLARIFICATION") {
        fallbackQuestion = `Could you clarify how you would handle ${focusArea} in a real-world scenario?`;
      } else if (targetQuestionType === "DEPTH_PROBE") {
        fallbackQuestion = `How does ${label} handle ${focusArea} under the hood, and what are the main trade-offs?`;
      } else if (targetQuestionType === "PRACTICAL") {
        fallbackQuestion = isTechnicalCategory
          ? `How would you implement, test, or optimize ${focusArea} in a real application?`
          : `In a production environment, how have you configured, tested, or optimized ${focusArea}?`;
      } else if (targetQuestionType === "SCENARIO" || targetQuestionType === "VALIDATION") {
        fallbackQuestion = `Could you walk through a concrete technical problem you encountered with ${focusArea} and how you resolved it?`;
      } else {
        fallbackQuestion = `Could you elaborate on ${focusArea} and provide a concrete example from your hands-on experience?`;
      }
    }

    return {
      question: fallbackQuestion,
      concept: `${topic.toLowerCase()} practical application`,
      topic: topic.toUpperCase(),
      difficulty: difficulty.toUpperCase(),
      questionType: targetQuestionType,
      competency: typeConfig.defaultCompetency,
      questionSource: "fallback",
    };
  }
}

export const aiQuestionService = new AiQuestionService();
export default aiQuestionService;
