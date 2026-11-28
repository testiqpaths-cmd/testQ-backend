import { phaseService } from "./phase.service.js";
import {
  INTERVIEW_PHASES,
  QUESTION_CATEGORIES,
  normalizePhase,
  categoryAllowsProjectContext,
  categoryUsesWorkHistory,
} from "../constants/interview-phases.js";
import {
  selectProjectForDeepDive,
  buildWorkHistoryContext,
} from "../resume/resume-project-context.js";

/**
 * Builds everything question generation needs to know about *where* in the
 * interview a question sits: its phase, its category, and the resume
 * evidence that category is allowed to use. Shared by live generation, the
 * background pre-buffer and follow-ups, so all three behave identically —
 * and identically for REST and socket interviews, which call the same
 * session service.
 */

/** Skills the interview actually tests, used to pick relevant projects. */
function technicalFocus(session) {
  const core = (session?.phasePlan || []).filter((p) =>
    [INTERVIEW_PHASES.CORE_TECHNICAL, INTERVIEW_PHASES.ADVANCED_TECHNICAL].includes(normalizePhase(p.phase))
  );
  const topics = core.flatMap((p) => p.topics || []);
  return topics.length ? topics : session?.resumeData?.extracted?.primarySkills || session?.techStack || [];
}

/** Skills to show the model: evidence-backed ones first. */
export function resumeSkillsFor(session) {
  const ex = session?.resumeData?.extracted;
  if (!ex) return session?.techStack || [];
  const primary = Array.isArray(ex.primarySkills) ? ex.primarySkills : [];
  const all = Array.isArray(ex.skills) ? ex.skills : [];
  return Array.from(new Set([...primary, ...all])).slice(0, 12);
}

/**
 * @param {Object} session
 * @param {string} topic
 * @param {Object} [opts]
 * @param {number} [opts.topicQuestionIndex=0] - questions already asked/prepared on this topic
 * @param {number} [opts.projectRotation=0] - deep-dive questions already asked/prepared
 * @param {Array}  [opts.recentTurns=[]] - recent turns with question/candidateAnswer
 */
export function buildQuestionContext(session, topic, { topicQuestionIndex = 0, projectRotation = 0, recentTurns = [] } = {}) {
  const phase = normalizePhase(phaseService.phaseOfTopic(session || {}, topic));
  const questionCategory = phaseService.categoryFor(session || {}, topic, { topicQuestionIndex });

  let projectContext = null;
  if (categoryAllowsProjectContext(questionCategory)) {
    projectContext = selectProjectForDeepDive(session?.resumeData, {
      focusSkills: technicalFocus(session),
      rotation: projectRotation,
    });
  }

  const needsWorkHistory =
    categoryUsesWorkHistory(questionCategory) ||
    (questionCategory === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE && !projectContext);
  const workHistory = needsWorkHistory ? buildWorkHistoryContext(session?.resumeData) : null;

  const recentAnswers = (recentTurns || [])
    .filter((t) => t && t.candidateAnswer && String(t.topic || "").toUpperCase() !== "")
    .slice(-2)
    .map((t) => ({ question: t.question, answer: t.candidateAnswer }));

  return {
    phase,
    questionCategory,
    projectContext,
    projectTitle: projectContext?.title || null,
    workHistory,
    recentAnswers,
    experienceProfile: session?.experienceProfile || null,
    resumeSkills: resumeSkillsFor(session),
  };
}

/** How many deep-dive questions exist already (asked turns + buffered). */
export function countProjectQuestions(pastTurns = [], prepared = []) {
  const asked = (pastTurns || []).filter(
    (t) => t && !t.isFollowUp && t.questionCategory === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE
  ).length;
  const buffered = (prepared || []).filter(
    (q) => q && ["READY", "CLAIMED"].includes(q.status) && q.questionCategory === QUESTION_CATEGORIES.PROJECT_DEEP_DIVE
  ).length;
  return asked + buffered;
}

export default { buildQuestionContext, countProjectQuestions, resumeSkillsFor };
