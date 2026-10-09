import { TYPE_TOPICS, INTERVIEW_TYPES } from "../constants/interview-types.js";

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
   * experience level, session duration, and selected interview type(s).
   *
   * @param {Object} params
   * @param {string} params.role - Target role (e.g. "Frontend Developer")
   * @param {string[]} [params.candidateSkills=[]] - Skills found on resume or specified
   * @param {number} [params.duration=30] - Duration in minutes
   * @param {string} [params.experienceLevel="1-3 Years"] - Experience level
   * @param {string[]} [params.interviewTypes=["technical"]] - Array of interview types
   * @returns {string[]} Selected scoped interview topics (ordered)
   */
  selectInterviewTopics({
    role = "Software Engineer",
    candidateSkills = [],
    duration = 30,
    experienceLevel = "1-3 Years",
    interviewTypes = ["technical"],
  }) {
    // 1. Determine max topics based on duration (do not overwhelm candidate)
    let maxTopics = 3;
    if (duration <= 15) maxTopics = 2;
    else if (duration <= 30) maxTopics = 4;
    else if (duration <= 45) maxTopics = 5;
    else maxTopics = 6;

    // 2. Normalize interviewTypes
    let normTypes = (Array.isArray(interviewTypes) && interviewTypes.length ? interviewTypes : ["technical"])
      .map((t) => String(t || "").toLowerCase().trim())
      .filter(Boolean);

    if (normTypes.includes(INTERVIEW_TYPES.MIXED)) {
      normTypes = [
        INTERVIEW_TYPES.TECHNICAL,
        INTERVIEW_TYPES.SYSTEM_DESIGN,
        INTERVIEW_TYPES.BEHAVIORAL,
        INTERVIEW_TYPES.HR,
      ];
    }

    // 3. Helper to get technical skills for this role
    const getTechnicalSkills = (count) => {
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

      scoredSkills.sort((a, b) => b.score - a.score);
      const selected = scoredSkills.map((s) => s.name.toUpperCase()).slice(0, count);

      if (selected.length === 0) {
        return roleCoreSkills.slice(0, count).map((s) => s.toUpperCase());
      }

      if (selected.length < count) {
        for (const core of roleCoreSkills) {
          const upper = core.toUpperCase();
          if (!selected.includes(upper)) {
            selected.push(upper);
            if (selected.length >= count) break;
          }
        }
      }

      return selected;
    };

    // 4. Single-type selection
    if (normTypes.length === 1) {
      const type = normTypes[0];

      if (type === INTERVIEW_TYPES.TECHNICAL) {
        const selected = getTechnicalSkills(maxTopics);
        return selected.length >= 2 ? selected : [...selected, "PROBLEM_SOLVING"].slice(0, 2);
      }

      if (type === INTERVIEW_TYPES.CODING) {
        const codingBank = TYPE_TOPICS.coding || [];
        // If candidate specified primary language, include it first
        const techSkills = getTechnicalSkills(1);
        const selected = [];
        if (techSkills.length > 0) selected.push(techSkills[0]);
        for (const t of codingBank) {
          if (!selected.includes(t)) selected.push(t);
          if (selected.length >= maxTopics) break;
        }
        return selected;
      }

      const bank = TYPE_TOPICS[type] || TYPE_TOPICS.hr;
      return bank.slice(0, maxTopics);
    }

    // 5. Multi-type selection: Allocate slots across types
    const slotsPerType = Math.max(1, Math.floor(maxTopics / normTypes.length));
    const combined = [];

    for (const type of normTypes) {
      if (type === INTERVIEW_TYPES.TECHNICAL) {
        const tech = getTechnicalSkills(slotsPerType);
        tech.forEach((t) => {
          if (!combined.includes(t)) combined.push(t);
        });
      } else if (type === INTERVIEW_TYPES.CODING) {
        const codingTopics = TYPE_TOPICS.coding || [];
        codingTopics.slice(0, slotsPerType).forEach((t) => {
          if (!combined.includes(t)) combined.push(t);
        });
      } else {
        const typeTopics = TYPE_TOPICS[type] || [];
        typeTopics.slice(0, slotsPerType).forEach((t) => {
          if (!combined.includes(t)) combined.push(t);
        });
      }
    }

    // Fill remaining slots if any
    if (combined.length < maxTopics) {
      for (const type of normTypes) {
        const bank = TYPE_TOPICS[type] || (type === INTERVIEW_TYPES.TECHNICAL ? getTechnicalSkills(maxTopics) : []);
        for (const t of bank) {
          if (!combined.includes(t)) {
            combined.push(t);
            if (combined.length >= maxTopics) break;
          }
        }
        if (combined.length >= maxTopics) break;
      }
    }

    return combined.slice(0, maxTopics);
  }
}

export const resumeTopicService = new ResumeTopicService();
export default resumeTopicService;
