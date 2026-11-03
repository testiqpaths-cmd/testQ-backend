/**
 * Helper to extract bounded, relevant candidate project evidence for question generation.
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
