import { PHASE_ORDER, phaseForTopic, buildPhasePlan } from "../constants/interview-phases.js";
import logger from "../../config/logger.js";

/**
 * Bookkeeping for the phase layer. Every method is a safe no-op when the
 * session has no phasePlan, so the adaptive engine is unaffected for
 * sessions created before this layer existed.
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
    const cur = session.currentPhase;
    return session.phasePlan.find((p) => p.phase === cur) || session.phasePlan[0];
  }

  /** Topics belonging to the current phase (falls back to all topics). */
  currentPhaseTopics(session) {
    const entry = this.currentEntry(session);
    return entry?.topics?.length ? entry.topics : session.topicOrder || session.allowedTopics || [];
  }

  /**
   * Has the current phase used up its budget or covered all its topics?
   */
  isPhaseExhausted(session) {
    const entry = this.currentEntry(session);
    if (!entry) return false;
    if ((entry.questionsAsked || 0) >= (entry.questionBudget || 0)) return true;

    const cov = Array.isArray(session.coverageState) ? session.coverageState : [];
    const covered = entry.topics.every((t) => {
      const c = cov.find((x) => x.topic?.toUpperCase() === t.toUpperCase());
      return c && ["EVALUATED", "SKIPPED"].includes(c.status);
    });
    return covered && entry.topics.length > 0;
  }

  /** Topics belonging to phases strictly after the current one. */
  laterPhaseTopics(session) {
    if (!this.hasPlan(session)) return [];
    const curIdx = PHASE_ORDER.indexOf(session.currentPhase);
    return session.phasePlan
      .filter((p) => PHASE_ORDER.indexOf(p.phase) > curIdx)
      .flatMap((p) => p.topics);
  }

  /** Next phase entry after the current one that still has room, or null. */
  nextPhaseEntry(session) {
    if (!this.hasPlan(session)) return null;
    const curIdx = PHASE_ORDER.indexOf(session.currentPhase);
    return (
      session.phasePlan.find((p) => {
        const idx = PHASE_ORDER.indexOf(p.phase);
        return idx > curIdx && p.status !== "COMPLETED";
      }) || null
    );
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
    const entry = session.phasePlan.find((p) => p.phase === phaseName);
    if (entry) {
      entry.questionsAsked = (entry.questionsAsked || 0) + 1;
      if (entry.status === "PENDING") entry.status = "IN_PROGRESS";
    }
    if (typeof session.markModified === "function") session.markModified("phasePlan");
  }

  /**
   * Move `currentPhase` to the phase that owns `topic` (called from the
   * SWITCH_TOPIC branch). Marks every earlier phase COMPLETED and the new
   * one IN_PROGRESS. No-op if the topic is in the current phase already.
   */
  enterPhaseForTopic(session, topic) {
    if (!this.hasPlan(session)) return;
    const target = this.#phaseOwningTopic(session, topic);
    if (!target || target === session.currentPhase) return;

    const targetIdx = PHASE_ORDER.indexOf(target);
    for (const p of session.phasePlan) {
      const idx = PHASE_ORDER.indexOf(p.phase);
      if (idx < targetIdx) p.status = "COMPLETED";
      else if (idx === targetIdx && p.status !== "COMPLETED") p.status = "IN_PROGRESS";
    }
    logger.info(`Session ${session.interviewId}: phase ${session.currentPhase} -> ${target}`);
    session.currentPhase = target;
    if (typeof session.markModified === "function") session.markModified("phasePlan");
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
