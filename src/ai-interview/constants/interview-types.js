/**
 * Central Interview Types constants, topics mapping, and resolution utilities.
 */

export const INTERVIEW_TYPES = Object.freeze({
  TECHNICAL: "technical",
  HR: "hr",
  BEHAVIORAL: "behavioral",
  CODING: "coding",
  SYSTEM_DESIGN: "system_design",
  PROJECT_BASED: "project_based",
  MANAGERIAL: "managerial",
  MIXED: "mixed",
});

export const TYPE_TOPICS = Object.freeze({
  hr: [
    "CULTURE_FIT",
    "CAREER_GOALS",
    "WORK_ETHIC",
    "TEAMWORK",
    "COMMUNICATION_SKILLS",
    "CONFLICT_RESOLUTION",
  ],
  behavioral: [
    "LEADERSHIP",
    "PROBLEM_SOLVING",
    "COLLABORATION",
    "ADAPTABILITY",
    "OVERCOMING_CHALLENGES",
    "DECISION_MAKING",
  ],
  system_design: [
    "HIGH_LEVEL_ARCHITECTURE",
    "SCALABILITY",
    "DATABASE_DESIGN",
    "CACHING_STRATEGIES",
    "MICROSERVICES",
    "FAULT_TOLERANCE",
  ],
  managerial: [
    "TEAM_LEADERSHIP",
    "PROJECT_DELIVERY",
    "STAKEHOLDER_COMMUNICATION",
    "MENTORSHIP",
    "PRIORITIZATION_AND_RESOURCE_ALLOCATION",
  ],
  project_based: [
    "PROJECT_ARCHITECTURE",
    "TECHNICAL_CHALLENGES",
    "DESIGN_PATTERNS",
    "PRODUCTION_ISSUES",
    "OPTIMIZATION_AND_SCALE",
  ],
  coding: [
    "DATA_STRUCTURES",
    "ALGORITHMS",
    "TIME_COMPLEXITY",
    "PROBLEM_SOLVING",
    "CODE_OPTIMIZATION",
  ],
  technical: [
    "TECHNICAL_FUNDAMENTALS",
    "PROBLEM_SOLVING",
  ],
});

/**
 * Resolves the primary interview type for a given topic, taking session interviewTypes into account.
 *
 * @param {string} topic
 * @param {string[]} [sessionInterviewTypes=["technical"]]
 * @returns {string} One of INTERVIEW_TYPES
 */
export function resolveInterviewTypeForTopic(topic, sessionInterviewTypes = ["technical"]) {
  const t = String(topic || "").toUpperCase();

  // 1. Match topic signatures
  if (
    [
      "CULTURE_FIT",
      "CAREER_GOALS",
      "WORK_ETHIC",
      "TEAMWORK",
      "COMMUNICATION_SKILLS",
      "CONFLICT_RESOLUTION",
      "HR",
    ].some((k) => t.includes(k))
  ) {
    return INTERVIEW_TYPES.HR;
  }

  if (
    [
      "LEADERSHIP",
      "BEHAVIORAL",
      "BEHAVIOURAL",
      "COLLABORATION",
      "ADAPTABILITY",
      "OVERCOMING_CHALLENGES",
      "DECISION_MAKING",
      "SITUATION",
    ].some((k) => t.includes(k))
  ) {
    return INTERVIEW_TYPES.BEHAVIORAL;
  }

  if (
    [
      "TEAM_LEADERSHIP",
      "MANAGERIAL",
      "PROJECT_DELIVERY",
      "STAKEHOLDER",
      "MENTORSHIP",
      "RESOURCE_ALLOCATION",
      "PRIORITIZATION",
    ].some((k) => t.includes(k))
  ) {
    return INTERVIEW_TYPES.MANAGERIAL;
  }

  if (
    [
      "SYSTEM_DESIGN",
      "HIGH_LEVEL_ARCHITECTURE",
      "SCALABILITY",
      "DATABASE_DESIGN",
      "CACHING_STRATEGIES",
      "MICROSERVICES",
      "FAULT_TOLERANCE",
    ].some((k) => t.includes(k))
  ) {
    return INTERVIEW_TYPES.SYSTEM_DESIGN;
  }

  if (
    [
      "PROJECT_ARCHITECTURE",
      "TECHNICAL_CHALLENGES",
      "DESIGN_PATTERNS",
      "PRODUCTION_ISSUES",
      "OPTIMIZATION_AND_SCALE",
      "PROJECT",
    ].some((k) => t.includes(k))
  ) {
    return INTERVIEW_TYPES.PROJECT_BASED;
  }

  if (
    [
      "DATA_STRUCTURES",
      "ALGORITHMS",
      "TIME_COMPLEXITY",
      "CODING",
      "CODE_OPTIMIZATION",
    ].some((k) => t.includes(k))
  ) {
    return INTERVIEW_TYPES.CODING;
  }

  // 2. If topic name doesn't specify, fall back to session's primary interview type
  const normTypes = (Array.isArray(sessionInterviewTypes) ? sessionInterviewTypes : [sessionInterviewTypes])
    .map((x) => String(x || "").toLowerCase())
    .filter(Boolean);

  const primary = normTypes[0] || INTERVIEW_TYPES.TECHNICAL;
  if (primary === INTERVIEW_TYPES.MIXED) {
    return INTERVIEW_TYPES.TECHNICAL;
  }
  return primary;
}

/**
 * Returns persona and metadata configuration tailored to the interview type.
 */
export function getTypePersonaAndConfig(interviewType, role = "Software Engineer", experienceLevel = "1-3 Years") {
  const normType = String(interviewType || INTERVIEW_TYPES.TECHNICAL).toLowerCase();

  switch (normType) {
    case INTERVIEW_TYPES.HR:
      return {
        persona: `You are an experienced Senior HR and Talent Acquisition Partner for TestQ conducting an HR interview for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate cultural fit, professional values, career aspirations, workplace ethics, teamwork, adaptability, and communication skills.`,
        defaultQuestionType: "HR",
        defaultCompetency: "Culture & Professionalism",
        focusSummary: "cultural alignment, motivation, work ethic, teamwork, and communication",
      };

    case INTERVIEW_TYPES.BEHAVIORAL:
      return {
        persona: `You are an expert Behavioral Interviewer for TestQ conducting a behavioral interview using the STAR methodology (Situation, Task, Action, Result) for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate how the candidate handled past real-world workplace situations, leadership challenges, conflict resolution, accountability, and problem solving.`,
        defaultQuestionType: "BEHAVIORAL",
        defaultCompetency: "Behavioral & Leadership",
        focusSummary: "STAR methodology, past experiences, interpersonal conflict, leadership, and accountability",
      };

    case INTERVIEW_TYPES.SYSTEM_DESIGN:
      return {
        persona: `You are a Principal Systems Architect for TestQ conducting a system design and architecture interview for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate high-level system architecture, scalability, database design, caching strategies, microservices, fault tolerance, and trade-offs under scale.`,
        defaultQuestionType: "SCENARIO",
        defaultCompetency: "System Architecture & Scalability",
        focusSummary: "high-level architecture, scalability, reliability, bottlenecks, and engineering trade-offs",
      };

    case INTERVIEW_TYPES.MANAGERIAL:
      return {
        persona: `You are an Engineering Director and Hiring Manager for TestQ conducting a managerial interview for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate engineering management, project delivery, stakeholder communication, mentoring, prioritization, and resource allocation.`,
        defaultQuestionType: "BEHAVIORAL",
        defaultCompetency: "People & Project Leadership",
        focusSummary: "team leadership, stakeholder management, delivery prioritization, and mentorship",
      };

    case INTERVIEW_TYPES.PROJECT_BASED:
      return {
        persona: `You are a Senior Engineering Project Evaluator for TestQ conducting a deep-dive project-based interview for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate real-world project architecture, technical challenges overcome, architectural design patterns, production incidents, and optimization decisions.`,
        defaultQuestionType: "PROJECT",
        defaultCompetency: "Project Execution & Architecture",
        focusSummary: "real-world project architecture, implementation hurdles, production debugging, and trade-offs",
      };

    case INTERVIEW_TYPES.CODING:
      return {
        persona: `You are a Senior Software Engineer for TestQ conducting a coding, data structures, and algorithmic problem-solving interview for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate algorithmic thinking, data structure selection, time and space complexity analysis, and edge case handling.`,
        defaultQuestionType: "PROBLEM_SOLVING",
        defaultCompetency: "Problem Solving & Algorithms",
        focusSummary: "data structures, algorithms, time and space complexity, and edge case handling",
      };

    case INTERVIEW_TYPES.TECHNICAL:
    default:
      return {
        persona: `You are a professional technical interviewer for TestQ conducting a technical interview for the role of ${role} (${experienceLevel}).`,
        goal: `Your goal is to evaluate practical technical knowledge, internal mechanics, syntax, framework concepts, and engineering best practices.`,
        defaultQuestionType: "TECHNICAL",
        defaultCompetency: "Technical Knowledge",
        focusSummary: "technical correctness, internal mechanics, practical implementation, and best practices",
      };
  }
}
