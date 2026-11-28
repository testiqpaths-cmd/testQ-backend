/**
 * Helpers to extract bounded resume evidence for question generation.
 *
 * Which questions may use project evidence is decided by the question
 * category (constants/interview-phases.js): only PROJECT_DEEP_DIVE
 * questions get a project; technical questions are asked standalone.
 */

/**
 * Finds the most relevant project evidence snippet from the candidate's resumeData
 * matching a given interview topic.
 *
 * @param {Object} resumeData - Session resumeData object
 * @param {string} topic - Current interview topic (e.g. "DJANGO", "PYTHON", "REACT")
 * @returns {Object|null} Compact, bounded project evidence object or null
 */
export function findRelevantProjectContext(resumeData, topic) {
  if (!resumeData || !resumeData.extracted) return null;
  const projects = Array.isArray(resumeData.extracted.projects) ? resumeData.extracted.projects : [];
  if (projects.length === 0) return null;

  const normTopic = String(topic || "").trim().toLowerCase();
  if (["INTRODUCTION", "HR", "CULTURE_FIT"].includes(normTopic.toUpperCase())) {
    return null;
  }

  // 1. Direct match in project technologies
  let matched = projects.find((p) => {
    const techs = Array.isArray(p.technologies) ? p.technologies.map((t) => String(t).toLowerCase()) : [];
    return techs.some((t) => t === normTopic || normTopic.includes(t) || t.includes(normTopic));
  });

  // 2. Textual match in project title or description
  if (!matched) {
    matched = projects.find((p) => {
      const full = `${p.title} ${p.description}`.toLowerCase();
      return full.includes(normTopic);
    });
  }

  // 3. Fallback: if general technical topic, supply first project as reference context
  const selected = matched || projects[0];
  if (!selected) return null;

  return {
    title: String(selected.title || "Project").trim().slice(0, 60),
    description: String(selected.description || "").trim().slice(0, 250),
    technologies: (Array.isArray(selected.technologies) ? selected.technologies : []).map(String).slice(0, 6),
    architecture: String(selected.architecture || "").trim().slice(0, 150),
    contributions: (Array.isArray(selected.contributions) ? selected.contributions : []).map(String).slice(0, 2),
    evidenceSnippet: String(selected.evidenceSnippet || "").trim().slice(0, 150),
  };
}

const compactProject = (p) => ({
  title: String(p.title || "Project").trim().slice(0, 60),
  description: String(p.description || "").trim().slice(0, 250),
  technologies: (Array.isArray(p.technologies) ? p.technologies : []).map(String).slice(0, 6),
  architecture: String(p.architecture || "").trim().slice(0, 150),
  contributions: (Array.isArray(p.contributions) ? p.contributions : []).map(String).slice(0, 2),
  evidenceSnippet: String(p.evidenceSnippet || "").trim().slice(0, 150),
});

/**
 * Ranks resume projects for the PROJECT_DEEP_DIVE phase: projects whose
 * technologies overlap the interview's technical topics come first, then
 * those with more concrete claims (architecture, contributions). Returns
 * the project at `rotation` in that order, so successive deep-dive
 * questions explore different projects instead of the same one.
 *
 * @param {Object} resumeData - Session resumeData
 * @param {Object} opts
 * @param {string[]} [opts.focusSkills] - Technical topics of this interview
 * @param {number} [opts.rotation=0] - How many deep-dive questions already exist
 * @returns {Object|null} Compact project context, or null if the resume has none
 */
export function selectProjectForDeepDive(resumeData, { focusSkills = [], rotation = 0 } = {}) {
  const projects = Array.isArray(resumeData?.extracted?.projects) ? resumeData.extracted.projects : [];
  if (projects.length === 0) return null;

  const focus = new Set(
    (focusSkills || []).map((s) => String(s || "").replace(/^ADVANCED_/i, "").toLowerCase()).filter(Boolean)
  );
  const scored = projects.slice(0, 5).map((p, idx) => {
    const techs = (Array.isArray(p.technologies) ? p.technologies : []).map((t) => String(t).toLowerCase());
    const overlap = techs.filter((t) => focus.has(t)).length;
    const concreteness =
      (p.architecture ? 1 : 0) + Math.min(2, (p.contributions || []).length) + (p.description ? 0.5 : 0);
    return { p, idx, score: overlap * 3 + concreteness };
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

  const pick = scored[Math.abs(Number(rotation) || 0) % scored.length];
  return pick ? compactProject(pick.p) : null;
}

/**
 * Compact work-history context for EXPERIENCE / BEHAVIORAL questions: the
 * most recent roles with their stated technologies and a responsibility or
 * two. Null when the resume lists no work history.
 */
export function buildWorkHistoryContext(resumeData, { limit = 2 } = {}) {
  const experience = Array.isArray(resumeData?.extracted?.experience) ? resumeData.extracted.experience : [];
  const entries = experience
    .filter((e) => e && (e.role || e.company))
    .slice(0, limit)
    .map((e) => ({
      role: String(e.role || "").trim().slice(0, 60),
      company: String(e.company || "").trim().slice(0, 60),
      duration: String(e.duration || "").trim().slice(0, 40),
      technologies: (Array.isArray(e.technologies) ? e.technologies : []).map(String).slice(0, 6),
      responsibilities: (Array.isArray(e.responsibilities) ? e.responsibilities : [])
        .map((r) => String(r).trim().slice(0, 140))
        .slice(0, 2),
    }));
  return entries.length ? entries : null;
}
