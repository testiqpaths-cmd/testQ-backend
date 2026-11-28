/**
 * Experience bands drive the interview strategy: which phases run, how the
 * question budget is split between them, where difficulty starts, and what
 * depth an answer is expected to show.
 *
 * Everything here is data, not a question script. The strategy service turns
 * it into a phase plan; the adaptive engine still moves difficulty up or down
 * from the band's starting point based on actual answers.
 */

export const EXPERIENCE_BANDS = Object.freeze({
  FRESHER: "FRESHER",
  JUNIOR: "JUNIOR",
  MID: "MID",
  SENIOR: "SENIOR",
  LEAD: "LEAD",
});

export const BAND_ORDER = [
  EXPERIENCE_BANDS.FRESHER,
  EXPERIENCE_BANDS.JUNIOR,
  EXPERIENCE_BANDS.MID,
  EXPERIENCE_BANDS.SENIOR,
  EXPERIENCE_BANDS.LEAD,
];

// Lower bound (years, inclusive) of each band.
const BAND_MIN_YEARS = [
  [EXPERIENCE_BANDS.LEAD, 7],
  [EXPERIENCE_BANDS.SENIOR, 4],
  [EXPERIENCE_BANDS.MID, 2],
  [EXPERIENCE_BANDS.JUNIOR, 1],
  [EXPERIENCE_BANDS.FRESHER, 0],
];

export function bandForYears(years) {
  const y = Number(years);
  if (!Number.isFinite(y) || y < 0) return null;
  for (const [band, min] of BAND_MIN_YEARS) {
    if (y >= min) return band;
  }
  return EXPERIENCE_BANDS.FRESHER;
}

export function bandIndex(band) {
  return BAND_ORDER.indexOf(band);
}

/**
 * Parses a selected experience level ("0-1 Years", "3-5 Years", "5+ Years",
 * "Fresher", "Senior", ...) into an estimated year count. Ranges use a point
 * 40% of the way into the range so "3-5 Years" reads as mid-level (3.8) and
 * "1-3 Years" as junior (1.8) rather than rounding everyone up.
 *
 * @returns {number|null} estimated years, or null when unparseable
 */
export function parseExperienceLevel(level) {
  if (level == null) return null;
  if (typeof level === "number") return Number.isFinite(level) && level >= 0 ? level : null;
  const s = String(level).trim().toLowerCase();
  if (!s) return null;

  if (/\b(fresher|fresh graduate|graduate|intern|internship|student|entry[\s-]?level|no experience)\b/.test(s)) return 0.5;
  if (/\b(principal|architect|staff|lead|head|director)\b/.test(s)) return 8;
  if (/\bsenior\b/.test(s)) return 5;
  if (/\b(mid|intermediate)\b/.test(s)) return 3;
  if (/\bjunior\b/.test(s)) return 1.5;

  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (hi >= lo) return lo + (hi - lo) * 0.4;
  }
  const plus = s.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return Number(plus[1]);
  const single = s.match(/(\d+(?:\.\d+)?)/);
  if (single) return Number(single[1]);
  return null;
}

/**
 * Per-band strategy. `phases` maps a phase to its share of the question
 * budget (`weight`) and its keep-priority when the interview is too short
 * for every phase (1 = keep first). CORE_TECHNICAL is always kept: a short
 * interview never skips technical evaluation.
 */
export const BAND_STRATEGIES = Object.freeze({
  [EXPERIENCE_BANDS.FRESHER]: {
    label: "Fresher (0–1 years)",
    objective: "fundamentals, programming knowledge, logical thinking and learning ability",
    expectedDepth:
      "clear definitions, correct basic mechanics and simple worked examples. Do not expect production or large-scale experience.",
    evaluationPriorities: ["fundamentals", "logical thinking", "learning ability"],
    baselineDifficulty: "EASY",
    maxPrebufferDifficulty: "MEDIUM",
    coreTopicExtras: ["PROBLEM_SOLVING"],
    advancedSystemTopics: [],
    evaluationTopic: "LEARNING_ABILITY",
    phases: {
      PROFESSIONAL_EXPERIENCE: { weight: 0.08, priority: 5 },
      CORE_TECHNICAL: { weight: 0.42, priority: 1 },
      PROJECT_DEEP_DIVE: { weight: 0.2, priority: 2 },
      SCENARIO_BASED: { weight: 0.15, priority: 3 },
      EXPERIENCE_EVALUATION: { weight: 0.15, priority: 4 },
    },
  },
  [EXPERIENCE_BANDS.JUNIOR]: {
    label: "Junior (1–2 years)",
    objective: "practical implementation and working independently on assigned tasks",
    expectedDepth:
      "correct concepts plus how they are applied in real code, common pitfalls and basic debugging.",
    evaluationPriorities: ["implementation", "debugging", "practical knowledge"],
    baselineDifficulty: "EASY",
    maxPrebufferDifficulty: "MEDIUM",
    coreTopicExtras: [],
    advancedSystemTopics: [],
    evaluationTopic: "OWNERSHIP",
    phases: {
      PROFESSIONAL_EXPERIENCE: { weight: 0.1, priority: 4 },
      CORE_TECHNICAL: { weight: 0.35, priority: 1 },
      ADVANCED_TECHNICAL: { weight: 0.1, priority: 6 },
      PROJECT_DEEP_DIVE: { weight: 0.2, priority: 2 },
      SCENARIO_BASED: { weight: 0.15, priority: 3 },
      EXPERIENCE_EVALUATION: { weight: 0.1, priority: 5 },
    },
  },
  [EXPERIENCE_BANDS.MID]: {
    label: "Mid-level (2–4 years)",
    objective: "technical depth, feature ownership, debugging, architecture understanding and independent problem-solving",
    expectedDepth:
      "internals and trade-offs, not only definitions; performance and debugging reasoning; ownership of features end to end.",
    evaluationPriorities: ["technical depth", "ownership", "problem-solving"],
    baselineDifficulty: "MEDIUM",
    maxPrebufferDifficulty: "HARD",
    coreTopicExtras: [],
    advancedSystemTopics: [],
    evaluationTopic: "TECHNICAL_OWNERSHIP",
    phases: {
      PROFESSIONAL_EXPERIENCE: { weight: 0.1, priority: 5 },
      CORE_TECHNICAL: { weight: 0.25, priority: 1 },
      ADVANCED_TECHNICAL: { weight: 0.2, priority: 2 },
      PROJECT_DEEP_DIVE: { weight: 0.2, priority: 3 },
      SCENARIO_BASED: { weight: 0.15, priority: 4 },
      EXPERIENCE_EVALUATION: { weight: 0.1, priority: 6 },
    },
  },
  [EXPERIENCE_BANDS.SENIOR]: {
    label: "Senior (4–7 years)",
    objective: "architecture, engineering decisions, scalability, production experience and technical leadership",
    expectedDepth:
      "architecture and trade-off reasoning, production failure handling, scalability and security. Textbook-only answers are shallow at this level.",
    evaluationPriorities: ["architecture", "scalability", "decision-making"],
    baselineDifficulty: "MEDIUM",
    maxPrebufferDifficulty: "HARD",
    coreTopicExtras: [],
    advancedSystemTopics: ["SYSTEM_DESIGN"],
    evaluationTopic: "TECHNICAL_DECISION_MAKING",
    phases: {
      PROFESSIONAL_EXPERIENCE: { weight: 0.1, priority: 6 },
      CORE_TECHNICAL: { weight: 0.12, priority: 3 },
      ADVANCED_TECHNICAL: { weight: 0.25, priority: 1 },
      PROJECT_DEEP_DIVE: { weight: 0.2, priority: 2 },
      SCENARIO_BASED: { weight: 0.18, priority: 4 },
      EXPERIENCE_EVALUATION: { weight: 0.15, priority: 5 },
    },
  },
  [EXPERIENCE_BANDS.LEAD]: {
    label: "Lead / Architect (7+ years)",
    objective: "system-level thinking, architectural leadership, technical strategy, reliability and business impact",
    expectedDepth:
      "system-level design across services and teams, reliability and cost trade-offs, engineering standards and business impact.",
    evaluationPriorities: ["strategy", "leadership", "engineering impact"],
    baselineDifficulty: "MEDIUM",
    maxPrebufferDifficulty: "HARD",
    coreTopicExtras: [],
    advancedSystemTopics: ["SYSTEM_DESIGN", "DISTRIBUTED_SYSTEMS"],
    evaluationTopic: "TECHNICAL_LEADERSHIP",
    phases: {
      PROFESSIONAL_EXPERIENCE: { weight: 0.1, priority: 6 },
      CORE_TECHNICAL: { weight: 0.08, priority: 4 },
      ADVANCED_TECHNICAL: { weight: 0.3, priority: 1 },
      PROJECT_DEEP_DIVE: { weight: 0.2, priority: 2 },
      SCENARIO_BASED: { weight: 0.14, priority: 5 },
      EXPERIENCE_EVALUATION: { weight: 0.18, priority: 3 },
    },
  },
});

export function getBandStrategy(band) {
  return BAND_STRATEGIES[band] || BAND_STRATEGIES[EXPERIENCE_BANDS.JUNIOR];
}

/** Compact, prompt-ready description of what this band should be evaluated on. */
export function describeBandForPrompt(profile) {
  if (!profile?.band) return "";
  const s = getBandStrategy(profile.band);
  const years =
    profile.effectiveYears != null ? ` (~${Math.round(profile.effectiveYears * 10) / 10} years)` : "";
  return `Candidate experience band: ${s.label}${years}.
Interview focus for this band: ${s.objective}.
Expected answer depth: ${s.expectedDepth}`;
}

export default {
  EXPERIENCE_BANDS,
  BAND_ORDER,
  BAND_STRATEGIES,
  bandForYears,
  bandIndex,
  parseExperienceLevel,
  getBandStrategy,
  describeBandForPrompt,
};
