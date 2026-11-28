import { INTERVIEW_PHASES, PHASE_ORDER } from "../constants/interview-phases.js";
import { INTERVIEW_TYPES, TYPE_TOPICS } from "../constants/interview-types.js";
import { EXPERIENCE_BANDS, getBandStrategy } from "../constants/experience-bands.js";
import { ResumeTopicService } from "../resume/resume-topic.service.js";

export const PHASE_TOPICS = Object.freeze({
  INTRODUCTION: "INTRODUCTION",
  WORK_EXPERIENCE: "WORK_EXPERIENCE",
  PROJECT_DEEP_DIVE: "PROJECT_DEEP_DIVE",
  TECHNICAL_SCENARIOS: "TECHNICAL_SCENARIOS",
});

// Non-technical interview types folded into an experience-aware plan, and
// the phase their topics belong to.
const TYPE_PHASE = {
  [INTERVIEW_TYPES.CODING]: INTERVIEW_PHASES.CORE_TECHNICAL,
  [INTERVIEW_TYPES.SYSTEM_DESIGN]: INTERVIEW_PHASES.ADVANCED_TECHNICAL,
  [INTERVIEW_TYPES.PROJECT_BASED]: INTERVIEW_PHASES.PROJECT_DEEP_DIVE,
  [INTERVIEW_TYPES.HR]: INTERVIEW_PHASES.EXPERIENCE_EVALUATION,
  [INTERVIEW_TYPES.BEHAVIORAL]: INTERVIEW_PHASES.EXPERIENCE_EVALUATION,
  [INTERVIEW_TYPES.MANAGERIAL]: INTERVIEW_PHASES.EXPERIENCE_EVALUATION,
};

const normalizeTypes = (interviewTypes) => {
  let types = (Array.isArray(interviewTypes) && interviewTypes.length ? interviewTypes : ["technical"])
    .map((t) => String(t || "").toLowerCase().trim())
    .filter(Boolean);
  if (types.includes(INTERVIEW_TYPES.MIXED)) {
    types = [
      INTERVIEW_TYPES.TECHNICAL,
      INTERVIEW_TYPES.SYSTEM_DESIGN,
      INTERVIEW_TYPES.BEHAVIORAL,
      INTERVIEW_TYPES.HR,
    ];
  }
  return Array.from(new Set(types));
};

// Skill areas used to spread technical questions across a candidate's
// stack (a full-stack resume gets React *and* Node.js *and* MongoDB, not
// three frontend questions). General-purpose languages go last in each
// round: "JavaScript" is usually covered through the framework questions.
const SKILL_AREAS = {
  frontend: ["react", "angular", "vue", "next.js", "nuxt", "svelte", "html", "css", "tailwindcss", "bootstrap", "sass", "redux", "zustand", "mobx", "jquery", "webpack", "vite"],
  backend: ["node.js", "express", "nestjs", "fastapi", "django", "flask", "spring boot", "spring", "asp.net", ".net", "laravel", "ruby on rails", "graphql", "rest", "grpc", "koa", "gin", "websocket", "microservices"],
  data: ["mongodb", "postgresql", "mysql", "redis", "sql", "sqlite", "dynamodb", "cassandra", "elasticsearch", "mongoose", "prisma", "typeorm", "sqlalchemy", "hibernate", "supabase", "firebase"],
  devops: ["docker", "kubernetes", "aws", "azure", "gcp", "ci/cd", "terraform", "ansible", "linux", "nginx", "kafka", "rabbitmq", "jenkins", "github actions", "gitlab ci", "git"],
  mobile: ["flutter", "react native", "android", "ios", "swiftui", "jetpack compose"],
  ml: ["pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "opencv", "machine learning"],
  testing: ["jest", "mocha", "cypress", "playwright", "selenium", "junit", "pytest"],
};
const LANGUAGE_AREA = "language";
const areaOf = (topic) => {
  const t = String(topic || "").toLowerCase();
  for (const [area, list] of Object.entries(SKILL_AREAS)) if (list.includes(t)) return area;
  return LANGUAGE_AREA; // languages and anything unrecognised
};

/**
 * Reorders ranked skill topics round-robin across skill areas, keeping rank
 * order within each area. Areas take turns in order of their best-ranked
 * skill; the language/other area always goes last in a round.
 */
export function diversifyTopics(rankedTopics = []) {
  const byArea = new Map();
  for (const t of rankedTopics) {
    const a = areaOf(t);
    if (!byArea.has(a)) byArea.set(a, []);
    byArea.get(a).push(t);
  }
  const areas = [...byArea.keys()].sort((a, b) => (a === LANGUAGE_AREA) - (b === LANGUAGE_AREA));
  const out = [];
  for (let round = 0; out.length < rankedTopics.length; round++) {
    for (const a of areas) {
      const list = byArea.get(a);
      if (round < list.length) out.push(list[round]);
    }
  }
  return out;
}

/** Splits `total` into integer shares proportional to `weights`, each >= 1. */
function apportion(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  if (total <= n) return weights.map((_, i) => (i < total ? 1 : 0));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const spare = total - n; // everyone gets 1, the rest by weight
  const raw = weights.map((w) => (spare * w) / sum);
  const shares = raw.map((r) => 1 + Math.floor(r));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), w: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) shares[order[k].i] += 1;
  return shares;
}

/**
 * Builds the experience-aware interview strategy for technical interviews:
 * which phases run, in what order, with what question and time budget, and
 * which topics each phase covers.
 *
 * Inputs are the candidate's experience profile (see
 * experience-level-resolver.service.js), ranked resume skills, resume
 * projects / work history, role, interview types, duration and the plan's
 * question limit. Output is a phase plan the existing phase layer and
 * adaptive engine already know how to walk.
 */
export class InterviewStrategyService {
  /** Experience-aware plans apply to interviews with a technical component. */
  appliesTo(interviewTypes) {
    const types = normalizeTypes(interviewTypes);
    return types.includes(INTERVIEW_TYPES.TECHNICAL);
  }

  /**
   * @param {Object} params
   * @param {string} params.role
   * @param {string[]} params.interviewTypes
   * @param {Object} params.profile - experience profile (band, workHistoryCount, ...)
   * @param {string[]} [params.candidateSkills]
   * @param {string[]} [params.primarySkills]
   * @param {string[]} [params.secondarySkills]
   * @param {Object} [params.extracted] - resume extracted data (projects, experience)
   * @param {string[]} [params.focusTopics] - topics the user explicitly asked for
   * @param {number} params.duration - minutes
   * @param {number} params.globalQuestionLimit - total questions incl. the intro
   * @returns {{ band, phasePlan: Array, orderedTopics: string[], topicBudgets: Array }}
   */
  buildStrategy({
    role = "Software Engineer",
    interviewTypes = ["technical"],
    profile,
    candidateSkills = [],
    primarySkills = null,
    secondarySkills = null,
    extracted = null,
    focusTopics = [],
    duration = 30,
    globalQuestionLimit = 10,
  }) {
    const band = profile?.band || EXPERIENCE_BANDS.JUNIOR;
    const cfg = getBandStrategy(band);
    const types = normalizeTypes(interviewTypes);
    const totalQuestions = Math.max(2, Number(globalQuestionLimit) || 10);
    const budget = totalQuestions - 1; // the introduction takes one

    const projectCount = Array.isArray(extracted?.projects) ? extracted.projects.length : 0;
    const workCount = Array.isArray(extracted?.experience) ? extracted.experience.length : 0;

    // ---- Candidate topics per phase ------------------------------------
    const ranked = ResumeTopicService.rankSkills({ role, candidateSkills, primarySkills, secondarySkills });
    const focus = (focusTopics || []).map((t) => String(t).toUpperCase()).filter(Boolean);
    // Focus topics first, as given; then resume skills spread across areas.
    const skillTopics = Array.from(new Set([...focus, ...diversifyTopics(ranked.map((s) => s.topic))]));

    // Advanced questions only on skills with evidence (used in a project or
    // job, or explicitly chosen for a custom interview) — never just listed.
    const evidencedSkills = Array.from(
      new Set([
        ...focus,
        ...diversifyTopics(ranked.filter((s) => s.evidence !== "SECONDARY").map((s) => s.topic)),
      ])
    );

    const typeTopics = {};
    for (const type of types) {
      const phase = TYPE_PHASE[type];
      if (!phase) continue;
      const bank = TYPE_TOPICS[type] || [];
      typeTopics[phase] = [...(typeTopics[phase] || []), ...bank.slice(0, 2)];
    }

    const candidates = {
      [INTERVIEW_PHASES.PROFESSIONAL_EXPERIENCE]:
        workCount > 0 || band !== EXPERIENCE_BANDS.FRESHER ? [PHASE_TOPICS.WORK_EXPERIENCE] : [],
      [INTERVIEW_PHASES.CORE_TECHNICAL]: [], // filled after budgets are known
      [INTERVIEW_PHASES.ADVANCED_TECHNICAL]: [
        ...(typeTopics[INTERVIEW_PHASES.ADVANCED_TECHNICAL] || []),
        ...cfg.advancedSystemTopics,
        ...evidencedSkills.filter((t) => !t.includes("_")).map((t) => `ADVANCED_${t}`),
      ],
      [INTERVIEW_PHASES.PROJECT_DEEP_DIVE]:
        projectCount > 0 || workCount > 0 || typeTopics[INTERVIEW_PHASES.PROJECT_DEEP_DIVE]
          ? [PHASE_TOPICS.PROJECT_DEEP_DIVE, ...(typeTopics[INTERVIEW_PHASES.PROJECT_DEEP_DIVE] || [])]
          : [],
      [INTERVIEW_PHASES.SCENARIO_BASED]: [PHASE_TOPICS.TECHNICAL_SCENARIOS],
      [INTERVIEW_PHASES.EXPERIENCE_EVALUATION]: [
        ...(typeTopics[INTERVIEW_PHASES.EXPERIENCE_EVALUATION] || []),
        cfg.evaluationTopic,
      ],
    };

    // ---- Which phases fit in the budget ---------------------------------
    // Phases the band doesn't use are dropped unless an interview type asks
    // for them (e.g. "system_design" on a junior interview).
    const phaseConfig = (phase) => {
      const base = cfg.phases[phase];
      if (typeTopics[phase]) return { weight: base?.weight ?? 0.15, priority: Math.min(base?.priority ?? 2, 2) };
      return base || null;
    };

    const available = Object.keys(candidates).filter((phase) => {
      if (phase === INTERVIEW_PHASES.CORE_TECHNICAL) return true;
      return phaseConfig(phase) && candidates[phase].length > 0;
    });
    available.sort((a, b) => phaseConfig(a).priority - phaseConfig(b).priority);

    // CORE_TECHNICAL always survives a short interview.
    const kept = [INTERVIEW_PHASES.CORE_TECHNICAL];
    for (const phase of available) {
      if (kept.length >= budget) break;
      if (!kept.includes(phase)) kept.push(phase);
    }
    const selected = PHASE_ORDER.filter((p) => kept.includes(p));

    // ---- Question budgets ------------------------------------------------
    const shares = apportion(
      budget,
      selected.map((p) => phaseConfig(p)?.weight ?? 0.1)
    );
    const phaseBudget = Object.fromEntries(selected.map((p, i) => [p, shares[i]]));

    // CORE topics: focus topics + ranked skills (+ band extras like
    // PROBLEM_SOLVING for freshers), backfilled with general competencies.
    const coreBudget = phaseBudget[INTERVIEW_PHASES.CORE_TECHNICAL];
    const extras = cfg.coreTopicExtras.filter((t) => !skillTopics.includes(t));
    const coreTopicCount = Math.max(1, Math.min(coreBudget, Math.ceil(coreBudget * 0.75)));
    const skillSlots = Math.max(1, coreTopicCount - (coreBudget >= 3 ? extras.length : 0));
    let coreTopics = ResumeTopicService.fillTechnicalSlots(skillTopics, skillSlots, band);
    if (coreBudget >= 3) coreTopics = [...coreTopics, ...extras];
    coreTopics.push(...(typeTopics[INTERVIEW_PHASES.CORE_TECHNICAL] || []));
    candidates[INTERVIEW_PHASES.CORE_TECHNICAL] = Array.from(new Set(coreTopics));

    // ---- Assemble the plan ------------------------------------------------
    const totalSeconds = Math.max(5, Number(duration) || 30) * 60;
    const secondsFor = (questions) => Math.round((totalSeconds * questions) / totalQuestions);

    const topicBudgets = [];
    const phasePlan = [
      {
        phase: INTERVIEW_PHASES.INTRODUCTION,
        topics: [PHASE_TOPICS.INTRODUCTION],
        questionBudget: 1,
        questionsAsked: 0,
        status: "IN_PROGRESS",
        priority: 0,
        timeBudgetSeconds: secondsFor(1),
      },
    ];

    for (const phase of selected) {
      const qBudget = phaseBudget[phase];
      // Never more topics than questions: each topic gets at least one.
      const topics = Array.from(new Set(candidates[phase])).slice(0, Math.max(1, qBudget));
      const perTopic = apportion(qBudget, topics.map(() => 1));
      topics.forEach((topic, i) =>
        topicBudgets.push({
          topic,
          targetQuestions: Math.max(1, perTopic[i]),
          allocatedMinutes: Math.max(1, Math.round(secondsFor(perTopic[i]) / 60)),
        })
      );
      phasePlan.push({
        phase,
        topics,
        questionBudget: qBudget,
        questionsAsked: 0,
        status: "PENDING",
        priority: phaseConfig(phase)?.priority ?? 1,
        timeBudgetSeconds: secondsFor(qBudget),
      });
    }

    phasePlan.push({
      phase: INTERVIEW_PHASES.CLOSING,
      topics: [],
      questionBudget: 0,
      questionsAsked: 0,
      status: "PENDING",
      priority: 0,
      timeBudgetSeconds: 0,
    });

    const orderedTopics = phasePlan
      .flatMap((p) => p.topics)
      .filter((t) => t !== PHASE_TOPICS.INTRODUCTION);

    return { band, phasePlan, orderedTopics, topicBudgets };
  }
}

export const interviewStrategyService = new InterviewStrategyService();
export default interviewStrategyService;
