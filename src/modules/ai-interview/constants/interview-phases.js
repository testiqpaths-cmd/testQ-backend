/**
 * Interview phases layered on top of the topic-driven adaptive engine.
 *
 * A phase is an ordered, named grouping of the session's topics with its
 * own question budget (and, for strategy-built plans, a time budget). The
 * engine still drives question-by-question adaptation within a phase;
 * phases decide which slice of the topic list is "live" and when to move
 * on. Absent a phasePlan the engine behaves exactly as before.
 *
 * Phase plans are built by interview-strategy.service.js (experience-aware,
 * for technical interviews) or by buildPhasePlan() below (keyword grouping,
 * for HR / behavioral / coding / custom-topic interviews).
 */

export const INTERVIEW_PHASES = Object.freeze({
  INTRODUCTION: "INTRODUCTION",
  PROFESSIONAL_EXPERIENCE: "PROFESSIONAL_EXPERIENCE",
  CORE_TECHNICAL: "CORE_TECHNICAL",
  ADVANCED_TECHNICAL: "ADVANCED_TECHNICAL",
  PROJECT_DEEP_DIVE: "PROJECT_DEEP_DIVE",
  SCENARIO_BASED: "SCENARIO_BASED",
  EXPERIENCE_EVALUATION: "EXPERIENCE_EVALUATION",
  CLOSING: "CLOSING",
  COMPLETED: "COMPLETED",
});

export const PHASE_ORDER = [
  INTERVIEW_PHASES.INTRODUCTION,
  INTERVIEW_PHASES.PROFESSIONAL_EXPERIENCE,
  INTERVIEW_PHASES.CORE_TECHNICAL,
  INTERVIEW_PHASES.ADVANCED_TECHNICAL,
  INTERVIEW_PHASES.PROJECT_DEEP_DIVE,
  INTERVIEW_PHASES.SCENARIO_BASED,
  INTERVIEW_PHASES.EXPERIENCE_EVALUATION,
  INTERVIEW_PHASES.CLOSING,
];

// Phase names stored on sessions created before the 8-phase model.
// Read-side only: lets in-flight sessions keep their ordering.
export const LEGACY_PHASE_ALIASES = Object.freeze({
  INTRO: INTERVIEW_PHASES.INTRODUCTION,
  EXPERIENCE: INTERVIEW_PHASES.PROFESSIONAL_EXPERIENCE,
  TECHNICAL: INTERVIEW_PHASES.CORE_TECHNICAL,
  PROJECT: INTERVIEW_PHASES.PROJECT_DEEP_DIVE,
  SCENARIO: INTERVIEW_PHASES.SCENARIO_BASED,
});

export function normalizePhase(phase) {
  if (!phase) return null;
  const p = String(phase).toUpperCase();
  return LEGACY_PHASE_ALIASES[p] || p;
}

/** Position of a phase (or legacy alias) in PHASE_ORDER; -1 if unknown. */
export function phaseIndex(phase) {
  return PHASE_ORDER.indexOf(normalizePhase(phase));
}

/**
 * Question category: what kind of question this is, independent of topic.
 * Drives prompt instructions and whether resume project context is allowed.
 */
export const QUESTION_CATEGORIES = Object.freeze({
  INTRODUCTION: "INTRODUCTION",
  EXPERIENCE: "EXPERIENCE",
  TECHNICAL_CONCEPT: "TECHNICAL_CONCEPT",
  TECHNICAL_IMPLEMENTATION: "TECHNICAL_IMPLEMENTATION",
  PROJECT_DEEP_DIVE: "PROJECT_DEEP_DIVE",
  SCENARIO_BASED: "SCENARIO_BASED",
  BEHAVIORAL: "BEHAVIORAL",
  CLOSING: "CLOSING",
});

const PHASE_DEFAULT_CATEGORY = {
  [INTERVIEW_PHASES.INTRODUCTION]: QUESTION_CATEGORIES.INTRODUCTION,
  [INTERVIEW_PHASES.PROFESSIONAL_EXPERIENCE]: QUESTION_CATEGORIES.EXPERIENCE,
  [INTERVIEW_PHASES.CORE_TECHNICAL]: QUESTION_CATEGORIES.TECHNICAL_CONCEPT,
  [INTERVIEW_PHASES.ADVANCED_TECHNICAL]: QUESTION_CATEGORIES.TECHNICAL_IMPLEMENTATION,
  [INTERVIEW_PHASES.PROJECT_DEEP_DIVE]: QUESTION_CATEGORIES.PROJECT_DEEP_DIVE,
  [INTERVIEW_PHASES.SCENARIO_BASED]: QUESTION_CATEGORIES.SCENARIO_BASED,
  [INTERVIEW_PHASES.EXPERIENCE_EVALUATION]: QUESTION_CATEGORIES.BEHAVIORAL,
  [INTERVIEW_PHASES.CLOSING]: QUESTION_CATEGORIES.CLOSING,
};

/**
 * Category for a question in `phase`. In CORE_TECHNICAL the first question
 * on a topic tests the concept; later ones (for non-freshers) move to
 * implementation, so a topic is probed from two angles without needing a
 * project.
 */
export function categoryForPhase(phase, { topicQuestionIndex = 0, band = null } = {}) {
  const p = normalizePhase(phase);
  if (
    p === INTERVIEW_PHASES.CORE_TECHNICAL &&
    topicQuestionIndex >= 1 &&
    band &&
    band !== "FRESHER"
  ) {
    return QUESTION_CATEGORIES.TECHNICAL_IMPLEMENTATION;
  }
  return PHASE_DEFAULT_CATEGORY[p] || QUESTION_CATEGORIES.TECHNICAL_CONCEPT;
}

// Stored questionType (turn schema enum) for each category.
export const CATEGORY_QUESTION_TYPE = Object.freeze({
  INTRODUCTION: "BEHAVIORAL",
  EXPERIENCE: "BEHAVIORAL",
  TECHNICAL_CONCEPT: "CONCEPTUAL",
  TECHNICAL_IMPLEMENTATION: "PRACTICAL",
  PROJECT_DEEP_DIVE: "PROJECT",
  SCENARIO_BASED: "SCENARIO",
  BEHAVIORAL: "BEHAVIORAL",
  CLOSING: "BEHAVIORAL",
});

/** Only project deep-dive questions may quote resume projects. */
export function categoryAllowsProjectContext(category) {
  return category === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE;
}

/** Experience questions get the candidate's work history instead. */
export function categoryUsesWorkHistory(category) {
  return category === QUESTION_CATEGORIES.EXPERIENCE || category === QUESTION_CATEGORIES.BEHAVIORAL;
}

const TOPIC_LABELS = {
  INTRODUCTION: "introduction",
  WORK_EXPERIENCE: "professional work experience",
  PROJECT_DEEP_DIVE: "the candidate's projects",
  TECHNICAL_SCENARIOS: "realistic technical scenarios",
  LEARNING_ABILITY: "learning ability",
  OWNERSHIP: "ownership",
  TECHNICAL_OWNERSHIP: "technical ownership",
  TECHNICAL_DECISION_MAKING: "technical decision-making",
  TECHNICAL_LEADERSHIP: "technical leadership",
};

/**
 * Human-readable topic for prompts and template questions:
 * "ADVANCED_NODE.JS" -> "Node.js (advanced)", "SYSTEM_DESIGN" -> "system design".
 * Technology names are title-cased only when they were all-caps keys.
 */
export function topicLabel(topic) {
  const t = String(topic || "").toUpperCase().trim();
  if (!t) return "this topic";
  if (TOPIC_LABELS[t]) return TOPIC_LABELS[t];
  const adv = t.match(/^ADVANCED_(.+)$/);
  if (adv) return `${topicLabel(adv[1])} (advanced)`;
  if (t.includes("_")) return t.toLowerCase().replace(/_/g, " ");
  const known = { "NODE.JS": "Node.js", "NEXT.JS": "Next.js", JAVASCRIPT: "JavaScript", TYPESCRIPT: "TypeScript", MONGODB: "MongoDB", POSTGRESQL: "PostgreSQL", MYSQL: "MySQL", GRAPHQL: "GraphQL" };
  if (known[t]) return known[t];
  if (t.length <= 4) return t; // AWS, SQL, CSS, GCP
  return t.charAt(0) + t.slice(1).toLowerCase();
}

// Fraction of the total question budget each phase gets in keyword-built
// plans (buildPhasePlan). Strategy-built plans use per-band weights from
// constants/experience-bands.js instead.
export const PHASE_WEIGHTS = {
  [INTERVIEW_PHASES.INTRODUCTION]: 0.1,
  [INTERVIEW_PHASES.PROFESSIONAL_EXPERIENCE]: 0.15,
  [INTERVIEW_PHASES.CORE_TECHNICAL]: 0.3,
  [INTERVIEW_PHASES.ADVANCED_TECHNICAL]: 0.15,
  [INTERVIEW_PHASES.PROJECT_DEEP_DIVE]: 0.15,
  [INTERVIEW_PHASES.SCENARIO_BASED]: 0.1,
  [INTERVIEW_PHASES.EXPERIENCE_EVALUATION]: 0.1,
};

// Keyword rules mapping a topic key to a phase. First match wins; anything
// unmatched is CORE_TECHNICAL (the workhorse phase). Plan membership always
// takes precedence over these rules (see phase.service.js).
const PHASE_TOPIC_RULES = [
  [INTERVIEW_PHASES.INTRODUCTION, ["INTRODUCTION", "INTRO", "ICEBREAK", "BACKGROUND", "ABOUT_YOU", "WARMUP"]],
  [INTERVIEW_PHASES.CLOSING, ["CLOSING"]],
  [
    INTERVIEW_PHASES.PROFESSIONAL_EXPERIENCE,
    ["WORK_EXPERIENCE", "EXPERIENCE", "CAREER", "RESUME", "WORK_HISTORY", "ROLE_FIT", "WORK_ETHIC"],
  ],
  [INTERVIEW_PHASES.SCENARIO_BASED, ["SCENARIO", "SITUATION"]],
  [
    INTERVIEW_PHASES.ADVANCED_TECHNICAL,
    [
      "ADVANCED_",
      "SYSTEM_DESIGN",
      "HIGH_LEVEL_ARCHITECTURE",
      "DISTRIBUTED_SYSTEMS",
      "MICROSERVICES",
      "SCALABILITY",
      "DATABASE_DESIGN",
      "CACHING_STRATEGIES",
      "FAULT_TOLERANCE",
    ],
  ],
  [
    INTERVIEW_PHASES.PROJECT_DEEP_DIVE,
    [
      "PROJECT",
      "PORTFOLIO",
      "CASE_STUDY",
      "TECHNICAL_CHALLENGES",
      "PRODUCTION_ISSUES",
      "OPTIMIZATION_AND_SCALE",
      "DESIGN_PATTERNS",
    ],
  ],
  [
    INTERVIEW_PHASES.EXPERIENCE_EVALUATION,
    [
      "OWNERSHIP",
      "LEARNING_ABILITY",
      "BEHAVIOURAL",
      "BEHAVIORAL",
      "HR",
      "CULTURE",
      "CONFLICT",
      "LEADERSHIP",
      "COMMUNICATION",
      "COLLABORATION",
      "ADAPTABILITY",
      "OVERCOMING_CHALLENGES",
      "DECISION_MAKING",
      "TEAMWORK",
      "MANAGERIAL",
      "STAKEHOLDER",
      "MENTORSHIP",
      "PRIORITIZATION",
      "GOALS",
    ],
  ],
];

export function phaseForTopic(topic) {
  const t = String(topic || "").toUpperCase();
  for (const [phase, keywords] of PHASE_TOPIC_RULES) {
    if (keywords.some((k) => t.includes(k))) return phase;
  }
  return INTERVIEW_PHASES.CORE_TECHNICAL;
}

/**
 * Partitions an ordered topic list into an ordered phase plan by keyword.
 * Used for interviews that don't get an experience-aware strategy (pure
 * HR / behavioral / coding / system-design / managerial interviews, and
 * custom interviews with explicitly configured topics).
 *
 * @param {string[]} topics - the session's topic list (already ordered)
 * @param {{ globalQuestionLimit?: number }} opts
 * @returns {Array<{phase, topics:string[], questionBudget:number, questionsAsked:number, status:string}>}
 */
export function buildPhasePlan(topics = [], { globalQuestionLimit = 10 } = {}) {
  const clean = (Array.isArray(topics) ? topics : []).map((t) => String(t).toUpperCase()).filter(Boolean);
  if (!clean.length) return [];

  const byPhase = new Map();
  for (const topic of clean) {
    const phase = phaseForTopic(topic);
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    if (!byPhase.get(phase).includes(topic)) byPhase.get(phase).push(topic);
  }

  const presentPhases = PHASE_ORDER.filter((p) => byPhase.has(p));
  const weightSum = presentPhases.reduce((s, p) => s + (PHASE_WEIGHTS[p] || 0), 0) || 1;

  let allocated = 0;
  const plan = presentPhases.map((phase, idx) => {
    const isLast = idx === presentPhases.length - 1;
    const phaseTopics = byPhase.get(phase);
    let budget = isLast
      ? Math.max(phaseTopics.length, globalQuestionLimit - allocated)
      : Math.max(
          phaseTopics.length,
          Math.round((globalQuestionLimit * (PHASE_WEIGHTS[phase] || 0)) / weightSum)
        );
    allocated += budget;
    return {
      phase,
      topics: phaseTopics,
      questionBudget: budget,
      questionsAsked: 0,
      status: idx === 0 ? "IN_PROGRESS" : "PENDING",
    };
  });

  return plan;
}

export default {
  INTERVIEW_PHASES,
  PHASE_ORDER,
  PHASE_WEIGHTS,
  LEGACY_PHASE_ALIASES,
  QUESTION_CATEGORIES,
  CATEGORY_QUESTION_TYPE,
  normalizePhase,
  phaseIndex,
  phaseForTopic,
  categoryForPhase,
  categoryAllowsProjectContext,
  categoryUsesWorkHistory,
  topicLabel,
  buildPhasePlan,
};
