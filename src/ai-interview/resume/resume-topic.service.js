export class ResumeTopicService {
  /**
   * Role-to-core competencies map used for relevance ranking
   */
  static ROLE_RELEVANCE = {
    frontend: ["JavaScript", "TypeScript", "React", "HTML", "CSS", "Next.js", "Redux", "TailwindCSS"],
    backend: ["Node.js", "Express", "NestJS", "Python", "Java", "PostgreSQL", "MongoDB", "REST", "Redis", "SQL"],
    fullstack: ["JavaScript", "React", "Node.js", "MongoDB", "PostgreSQL", "REST", "TypeScript"],
    devops: ["Docker", "Kubernetes", "AWS", "CI/CD", "Linux", "Terraform", "Git"],
    data: ["Python", "SQL", "PostgreSQL", "Pandas", "Machine Learning", "FastAPI"],
  };

  /**
   * Intelligently selects interview topics based on target role, candidate skills,
   * experience level, and session duration.
   *
   * @param {Object} params
   * @param {string} params.role - Target role (e.g. "Frontend Developer")
   * @param {string[]} params.candidateSkills - Skills found on resume or specified
   * @param {number} params.duration - Duration in minutes
   * @param {string} params.experienceLevel - Experience level
   * @returns {string[]} Selected scoped interview topics (ordered)
   */
  selectInterviewTopics({
    role = "Software Engineer",
    candidateSkills = [],
    duration = 30,
    experienceLevel = "1-3 Years",
  }) {
    const normRole = (role || "").toLowerCase();
    let roleCategory = "fullstack";

    if (normRole.includes("front") || normRole.includes("react") || normRole.includes("ui")) {
      roleCategory = "frontend";
    } else if (
      normRole.includes("back") ||
      normRole.includes("node") ||
      normRole.includes("api") ||
      normRole.includes("java")
    ) {
      roleCategory = "backend";
    } else if (normRole.includes("devops") || normRole.includes("cloud") || normRole.includes("infra")) {
      roleCategory = "devops";
    } else if (normRole.includes("data") || normRole.includes("ml") || normRole.includes("ai")) {
      roleCategory = "data";
    }

    const roleCoreSkills =
      ResumeTopicService.ROLE_RELEVANCE[roleCategory] ||
      ResumeTopicService.ROLE_RELEVANCE.fullstack;

    // Determine max topics based on duration (do not overwhelm candidate)
    let maxTopics = 3;
    if (duration <= 15) maxTopics = 2;
    else if (duration <= 30) maxTopics = 4;
    else if (duration <= 45) maxTopics = 5;
    else maxTopics = 6;

    // Score and rank candidate skills
    const scoredSkills = (candidateSkills || []).map((skill) => {
      const isCore = roleCoreSkills.some(
        (s) => s.toLowerCase() === skill.toLowerCase()
      );
      return {
        name: skill,
        score: isCore ? 10 : 3,
      };
    });

    // Sort by relevance score descending
    scoredSkills.sort((a, b) => b.score - a.score);

    const selected = scoredSkills
      .map((s) => s.name.toUpperCase())
      .slice(0, maxTopics);

    // Fallback: If no candidate skills matched or were provided, pick default role topics
    if (selected.length === 0) {
      return roleCoreSkills.slice(0, maxTopics).map((s) => s.toUpperCase());
    }

    // Always include at least 2 topics
    if (selected.length === 1 && roleCoreSkills.length > 1) {
      const fallback = roleCoreSkills.find((s) => s.toUpperCase() !== selected[0]);
      if (fallback) selected.push(fallback.toUpperCase());
    }

    return selected;
  }
}

export const resumeTopicService = new ResumeTopicService();
export default resumeTopicService;
