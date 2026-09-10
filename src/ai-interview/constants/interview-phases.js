/**
 * Interview phases layered on top of the topic-driven adaptive engine.
 *
 * A phase is an ordered, named grouping of the session's topics with its
 * own question budget. The engine still drives question-by-question
 * adaptation within a phase; phases just decide which slice of the topic
 * list is "live" and when to move on. Absent a phasePlan the engine
 * behaves exactly as before.
 */

export const INTERVIEW_PHASES = Object.freeze({
  INTRO: "INTRO",
  EXPERIENCE: "EXPERIENCE",
  TECHNICAL: "TECHNICAL",
  PROJECT: "PROJECT",
  SCENARIO: "SCENARIO",
  COMPLETED: "COMPLETED",
});

export const PHASE_ORDER = [
  INTERVIEW_PHASES.INTRO,
  INTERVIEW_PHASES.EXPERIENCE,
  INTERVIEW_PHASES.TECHNICAL,
  INTERVIEW_PHASES.PROJECT,
  INTERVIEW_PHASES.SCENARIO,
];

// Fraction of the total question budget each phase gets when it has at
// least one topic. Normalised over the phases that are actually present.
export const PHASE_WEIGHTS = {
  [INTERVIEW_PHASES.INTRO]: 0.1,
  [INTERVIEW_PHASES.EXPERIENCE]: 0.2,
  [INTERVIEW_PHASES.TECHNICAL]: 0.4,
  [INTERVIEW_PHASES.PROJECT]: 0.2,
  [INTERVIEW_PHASES.SCENARIO]: 0.1,
};

// Keyword rules mapping a topic key to a phase. First match wins; anything
// unmatched falls into TECHNICAL (the workhorse phase).
const PHASE_TOPIC_RULES = [
  [INTERVIEW_PHASES.INTRO, ["INTRO", "ICEBREAK", "BACKGROUND", "ABOUT_YOU", "WARMUP"]],
  [
    INTERVIEW_PHASES.EXPERIENCE,
    ["EXPERIENCE", "CAREER", "RESUME", "WORK_HISTORY", "ROLE_FIT"],
  ],
  [
    INTERVIEW_PHASES.PROJECT,
    ["PROJECT", "PORTFOLIO", "CASE_STUDY", "SYSTEM_DESIGN", "ARCHITECTURE", "DESIGN"],
  ],
  [
    INTERVIEW_PHASES.SCENARIO,
    [
      "SCENARIO",
      "BEHAVIOURAL",
      "BEHAVIORAL",
      "SITUATION",
      "HR",
      "CULTURE",
      "CONFLICT",
      "LEADERSHIP",
      "COMMUNICATION",
    ],
  ],
];

export function phaseForTopic(topic) {
  const t = String(topic || "").toUpperCase();
  for (const [phase, keywords] of PHASE_TOPIC_RULES) {
    if (keywords.some((k) => t.includes(k))) return phase;
  }
  return INTERVIEW_PHASES.TECHNICAL;
}

/**
 * Partitions an ordered topic list into an ordered phase plan.
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
  phaseForTopic,
  buildPhasePlan,
};
