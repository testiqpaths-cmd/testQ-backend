import {
  INTERVIEW_PHASES,
  phaseIndex,
  normalizePhase,
  phaseForTopic,
  buildPhasePlan,
  categoryForPhase,
} from "../constants/interview-phases.js";
import logger from "../../../config/logger.js";

// A phase that runs this far past its time budget is treated as done, so a
// few long answers early on can't starve every later phase.
const TIME_BUDGET_OVERRUN = 1.25;

// Skip ADVANCED_TECHNICAL when fundamentals averaged below this score
// across at least MIN_CORE_ANSWERS answers: probe breadth instead of
// stacking harder questions on a shaky base.
const WEAK_CORE_SCORE = 40;
const MIN_CORE_ANSWERS = 2;

/**
 * Bookkeeping for the phase layer. Every method is a safe no-op when the
 * session has no phasePlan, so the adaptive engine is unaffected for
 * sessions created before this layer existed.
 *
 * Phase transitions happen only through enterPhaseForTopic(), called by the
 * session service when the adaptive engine decides SWITCH_TOPIC. Follow-ups
 * keep their parent's topic, so they can never move the phase.
 */
export class PhaseService {
  build(topics, { globalQuestionLimit } = {}) {
    return buildPhasePlan(topics, { globalQuestionLimit });
  }

  hasPlan(session) {
    return Array.isArray(session?.phasePlan) && session.phasePlan.length > 0;
  }

  /** The plan entry for the session's current phase, or null. */
  currentEntry(session) {
    if (!this.hasPlan(session)) return null;
    const cur = normalizePhase(session.currentPhase);
    return session.phasePlan.find((p) => normalizePhase(p.phase) === cur) || session.phasePlan[0];
  }

  /** Topics belonging to the current phase (falls back to all topics). */
  currentPhaseTopics(session) {
    const entry = this.currentEntry(session);
    return entry?.topics?.length ? entry.topics : session.topicOrder || session.allowedTopics || [];
  }

  /**
   * Has the current phase used up its question budget, its time budget, or
   * covered all its topics?
   */
  isPhaseExhausted(session, now = Date.now()) {
    const entry = this.currentEntry(session);
    if (!entry) return false;
    if ((entry.questionsAsked || 0) >= (entry.questionBudget || 0)) return true;

    if (entry.timeBudgetSeconds > 0 && entry.startedAt && (entry.questionsAsked || 0) >= 1) {
      const elapsed = (now - new Date(entry.startedAt).getTime()) / 1000;
      if (elapsed >= entry.timeBudgetSeconds * TIME_BUDGET_OVERRUN) return true;
    }

    const cov = Array.isArray(session.coverageState) ? session.coverageState : [];
    const covered = (entry.topics || []).every((t) => {
      const c = cov.find((x) => x.topic?.toUpperCase() === t.toUpperCase());
      return c && ["EVALUATED", "SKIPPED"].includes(c.status);
    });
    return covered && (entry.topics || []).length > 0;
  }

  /**
   * Adaptive skip: should the planner pass over this upcoming phase?
   * Currently only ADVANCED_TECHNICAL, when the candidate's fundamentals
   * were weak — deeper questions there would only repeat the same gap.
   */
  shouldSkipPhase(session, entry) {
    if (normalizePhase(entry?.phase) !== INTERVIEW_PHASES.ADVANCED_TECHNICAL) return false;
    const core = (session.phasePlan || []).find(
      (p) => normalizePhase(p.phase) === INTERVIEW_PHASES.CORE_TECHNICAL
    );
    if (!core) return false;
    const coreTopics = new Set((core.topics || []).map((t) => t.toUpperCase()));
    const items = (session.coverageState || []).filter(
      (c) => coreTopics.has(String(c.topic || "").toUpperCase()) && (c.questionsAsked || 0) > 0
    );
    const answered = items.reduce((n, c) => n + (c.questionsAsked || 0), 0);
    if (answered < MIN_CORE_ANSWERS) return false;
    const avg = items.reduce((s, c) => s + (c.averageScore || 0), 0) / items.length;
    return avg < WEAK_CORE_SCORE;
  }

  /**
   * Can the interview still move to `topic`? False for topics in phases
   * before the current one, or in a phase that was completed or skipped.
   * Topics outside the plan stay reachable.
   */
  isTopicReachable(session, topic) {
    if (!this.hasPlan(session)) return true;
    const t = String(topic || "").toUpperCase();
    const entry = session.phasePlan.find((p) => (p.topics || []).some((x) => x.toUpperCase() === t));
    if (!entry) return true;
    const idx = phaseIndex(entry.phase);
    const cur = phaseIndex(session.currentPhase);
    if (idx < cur) return false;
    if (idx > cur && ["COMPLETED", "SKIPPED"].includes(entry.status)) return false;
    if (idx > cur && this.shouldSkipPhase(session, entry)) return false;
    return true;
  }

  /** Phases strictly after the current one that are still to be run. */
  #upcomingEntries(session) {
    if (!this.hasPlan(session)) return [];
    const curIdx = phaseIndex(session.currentPhase);
    return session.phasePlan.filter((p) => {
      if (phaseIndex(p.phase) <= curIdx) return false;
      if (["COMPLETED", "SKIPPED"].includes(p.status)) return false;
      return (p.topics || []).length > 0;
    });
  }

  /** Topics belonging to phases strictly after the current one. */
  laterPhaseTopics(session) {
    return this.#upcomingEntries(session)
      .filter((p) => !this.shouldSkipPhase(session, p))
      .flatMap((p) => p.topics);
  }

  /** Next phase entry after the current one that still has room, or null. */
  nextPhaseEntry(session) {
    return this.#upcomingEntries(session).find((p) => !this.shouldSkipPhase(session, p)) || null;
  }

  /** First topic of the earliest phase after the current one, or null. */
  nextPhaseFirstTopic(session) {
    const entry = this.nextPhaseEntry(session);
    return entry?.topics?.[0] || null;
  }

  /**
   * Count one asked question against whichever phase owns `topic`.
   * Does NOT advance the phase — the engine drives advancement via
   * isPhaseExhausted() + a SWITCH_TOPIC decision, so `currentPhase` only
   * ever moves through enterPhaseForTopic(). Mutates in place.
   */
  recordQuestion(session, topic) {
    if (!this.hasPlan(session)) return;
    const phaseName = this.#phaseOwningTopic(session, topic);
    const entry = session.phasePlan.find((p) => normalizePhase(p.phase) === normalizePhase(phaseName));
    if (entry) {
      entry.questionsAsked = (entry.questionsAsked || 0) + 1;
      if (entry.status === "PENDING") entry.status = "IN_PROGRESS";
      if (!entry.startedAt) entry.startedAt = new Date();
    }
    if (typeof session.markModified === "function") session.markModified("phasePlan");
  }

  /**
   * Move `currentPhase` to the phase that owns `topic` (called from the
   * SWITCH_TOPIC branch). Earlier phases are marked COMPLETED, or SKIPPED
   * if they never asked a question; the new one IN_PROGRESS. No-op if the
   * topic is in the current phase already.
   *
   * @returns {boolean} whether the phase changed
   */
  enterPhaseForTopic(session, topic) {
    if (!this.hasPlan(session)) return false;
    const target = this.#phaseOwningTopic(session, topic);
    if (!target || normalizePhase(target) === normalizePhase(session.currentPhase)) return false;

    const targetIdx = phaseIndex(target);
    for (const p of session.phasePlan) {
      const idx = phaseIndex(p.phase);
      if (idx < targetIdx) {
        if (p.status !== "COMPLETED" && p.status !== "SKIPPED") {
          p.status = (p.questionsAsked || 0) > 0 ? "COMPLETED" : "SKIPPED";
        }
      } else if (idx === targetIdx && p.status !== "COMPLETED") {
        p.status = "IN_PROGRESS";
        if (!p.startedAt) p.startedAt = new Date();
      }
    }
    logger.info(`Session ${session.interviewId}: phase ${session.currentPhase} -> ${target}`);
    session.currentPhase = target;
    if (typeof session.markModified === "function") session.markModified("phasePlan");
    return true;
  }

  /**
   * Interview finished: close every phase and move to CLOSING when the plan
   * has one. Unvisited phases are SKIPPED, so reports show what was covered.
   */
  closePlan(session) {
    if (!this.hasPlan(session)) return;
    for (const p of session.phasePlan) {
      if (p.status === "IN_PROGRESS") p.status = "COMPLETED";
      else if (p.status === "PENDING") {
        p.status = normalizePhase(p.phase) === INTERVIEW_PHASES.CLOSING ? "COMPLETED" : "SKIPPED";
      }
    }
    if (session.phasePlan.some((p) => normalizePhase(p.phase) === INTERVIEW_PHASES.CLOSING)) {
      session.currentPhase = INTERVIEW_PHASES.CLOSING;
    }
    if (typeof session.markModified === "function") session.markModified("phasePlan");
  }

  /**
   * Question category for the next question on `topic`. Sessions without a
   * plan get the keyword-derived phase's category.
   */
  categoryFor(session, topic, { topicQuestionIndex = 0 } = {}) {
    const phase = this.hasPlan(session) ? this.#phaseOwningTopic(session, topic) : phaseForTopic(topic);
    return categoryForPhase(phase, {
      topicQuestionIndex,
      band: session?.experienceProfile?.band || null,
    });
  }

  /**
   * Compact progress view for API responses.
   */
  progress(session) {
    if (!this.hasPlan(session)) return null;
    return {
      current: session.currentPhase,
      phases: session.phasePlan.map((p) => ({
        phase: p.phase,
        topics: p.topics,
        questionBudget: p.questionBudget,
        questionsAsked: p.questionsAsked || 0,
        status: p.status,
        ...(p.timeBudgetSeconds != null ? { timeBudgetSeconds: p.timeBudgetSeconds } : {}),
      })),
    };
  }

  /** Which phase owns `topic` (by plan membership, else keyword rule). */
  phaseOfTopic(session, topic) {
    return this.#phaseOwningTopic(session, topic);
  }

  #phaseOwningTopic(session, topic) {
    if (!topic) return session.currentPhase || null;
    const t = String(topic).toUpperCase();
    const owning = (session.phasePlan || []).find((p) =>
      (p.topics || []).some((x) => x.toUpperCase() === t)
    );
    return owning?.phase || phaseForTopic(topic);
  }
}

export const phaseService = new PhaseService();
export default phaseService;
