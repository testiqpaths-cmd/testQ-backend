import { TYPE_TOPICS, INTERVIEW_TYPES } from "../constants/interview-types.js";
import {
  EXPERIENCE_BANDS,
  bandForYears,
  parseExperienceLevel,
} from "../constants/experience-bands.js";

// General engineering competencies used ONLY when the resume doesn't
// provide enough technical skills. Never specific technologies.
const GENERAL_COMPETENCIES = ["PROBLEM_SOLVING", "SYSTEM_DESIGN", "TECHNICAL_FUNDAMENTALS"];

// Backfill order per band: freshers fill gaps with fundamentals first,
// seniors with design. Every entry is one of GENERAL_COMPETENCIES.
const BACKFILL_ORDER = {
  [EXPERIENCE_BANDS.FRESHER]: ["TECHNICAL_FUNDAMENTALS", "PROBLEM_SOLVING", "SYSTEM_DESIGN"],
  // JUNIOR is also the band of the "1-3 Years" default, so it keeps the
  // original backfill order.
  [EXPERIENCE_BANDS.JUNIOR]: GENERAL_COMPETENCIES,
  [EXPERIENCE_BANDS.MID]: GENERAL_COMPETENCIES,
  [EXPERIENCE_BANDS.SENIOR]: ["SYSTEM_DESIGN", "PROBLEM_SOLVING", "TECHNICAL_FUNDAMENTALS"],
  [EXPERIENCE_BANDS.LEAD]: ["SYSTEM_DESIGN", "PROBLEM_SOLVING", "TECHNICAL_FUNDAMENTALS"],
};

// Ranking scores. Evidence (used in a project/job) and role relevance both
// count; a role-relevant skill that's only listed can still beat an
// irrelevant one that was used, but never a relevant one that was used.
const SCORE = {
  PRIMARY_CORE: 10,
  SECONDARY_CORE: 6,
  PRIMARY_OTHER: 5,
  SECONDARY_OTHER: 2,
  UNCLASSIFIED_CORE: 10,
  UNCLASSIFIED_OTHER: 3,
};

export class ResumeTopicService {
  /**
   * Role-to-core competencies map used for relevance ranking
   */
  static ROLE_RELEVANCE = {
    frontend: ["JavaScript", "TypeScript", "React", "HTML", "CSS", "Next.js", "Redux", "TailwindCSS"],
    backend: ["Node.js", "Express", "NestJS", "Python", "Java", "PostgreSQL", "MongoDB", "REST", "Redis", "SQL"],
    fullstack: ["JavaScript", "React", "Node.js", "MongoDB", "PostgreSQL", "REST", "TypeScript"],
    devops: ["Docker", "Kubernetes", "AWS", "CI/CD", "Linux", "Terraform", "Git"],
    mobile: ["Flutter", "Kotlin", "Swift", "Dart", "React Native", "Android", "iOS"],
    data: ["Python", "PyTorch", "TensorFlow", "SQL", "PostgreSQL", "Pandas", "Machine Learning", "FastAPI"],
  };

  static roleCategory(role = "") {
    const normRole = String(role || "").toLowerCase();
    if (normRole.includes("front") || normRole.includes("react") || normRole.includes("ui")) return "frontend";
    if (normRole.includes("back") || normRole.includes("node") || normRole.includes("api") || normRole.includes("java")) {
      return "backend";
    }
    if (normRole.includes("devops") || normRole.includes("cloud") || normRole.includes("infra")) return "devops";
    if (
      normRole.includes("mobile") ||
      normRole.includes("flutter") ||
      normRole.includes("android") ||
      normRole.includes("ios")
    ) {
      return "mobile";
    }
    if (normRole.includes("data") || normRole.includes("ml") || normRole.includes("ai") || normRole.includes("learning")) {
      return "data";
    }
    return "fullstack";
  }

  /**
   * Ranks the candidate's own skills for the role. Primary skills (used in
   * projects/experience) outrank secondary ones (only listed) at equal role
   * relevance. When the caller has no primary/secondary split (custom
   * interviews, legacy resumes), every skill is unclassified and only role
   * relevance counts — the previous behaviour.
   *
   * @returns {Array<{ name: string, topic: string, score: number, evidence: "PRIMARY"|"SECONDARY"|"UNCLASSIFIED", roleCore: boolean }>}
   */
  static rankSkills({ role, candidateSkills = [], primarySkills = null, secondarySkills = null }) {
    const roleCoreSkills =
      ResumeTopicService.ROLE_RELEVANCE[ResumeTopicService.roleCategory(role)] ||
      ResumeTopicService.ROLE_RELEVANCE.fullstack;
    const isCore = (skill) => roleCoreSkills.some((s) => s.toLowerCase() === skill.toLowerCase());

    const primarySet = new Set((primarySkills || []).map((s) => String(s || "").trim().toLowerCase()).filter(Boolean));
    const secondarySet = new Set((secondarySkills || []).map((s) => String(s || "").trim().toLowerCase()).filter(Boolean));
    const hasSplit = primarySet.size > 0 || secondarySet.size > 0;

    // Union, primary first, preserving original casing and order.
    const seen = new Set();
    const unique = [];
    for (const raw of [...(primarySkills || []), ...(candidateSkills || []), ...(secondarySkills || [])]) {
      const cleaned = String(raw || "").trim();
      if (!cleaned) continue;
      const lower = cleaned.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      unique.push(cleaned);
    }

    const ranked = unique.map((name, order) => {
      const lower = name.toLowerCase();
      const roleCore = isCore(name);
      let evidence = "UNCLASSIFIED";
      let score = roleCore ? SCORE.UNCLASSIFIED_CORE : SCORE.UNCLASSIFIED_OTHER;
      if (hasSplit) {
        if (primarySet.has(lower)) {
          evidence = "PRIMARY";
          score = roleCore ? SCORE.PRIMARY_CORE : SCORE.PRIMARY_OTHER;
        } else {
          // Listed only (or not in either list): treat as secondary evidence.
          evidence = "SECONDARY";
          score = roleCore ? SCORE.SECONDARY_CORE : SCORE.SECONDARY_OTHER;
        }
      }
      return { name, topic: name.toUpperCase(), score, evidence, roleCore, order };
    });

    // Stable sort: score desc, then original order.
    ranked.sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.map(({ order, ...rest }) => rest);
  }

  /**
   * Fills `count` technical slots from ranked skill topics, backfilling
   * with general competencies in band order. Never invents technologies.
   */
  static fillTechnicalSlots(rankedTopics, count, band = EXPERIENCE_BANDS.JUNIOR) {
    const selected = rankedTopics.slice(0, count);
    const backfill = BACKFILL_ORDER[band] || GENERAL_COMPETENCIES;
    if (selected.length === 0) return backfill.slice(0, count);
    for (const comp of backfill) {
      if (selected.length >= count) break;
      if (!selected.includes(comp)) selected.push(comp);
    }
    return selected;
  }

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
   * @param {string[]} [params.primarySkills] - Resume skills backed by projects/experience
   * @param {string[]} [params.secondarySkills] - Resume skills only listed
   * @returns {string[]} Selected scoped interview topics (ordered)
   */
  selectInterviewTopics({
    role = "Software Engineer",
    candidateSkills = [],
    duration = 30,
    experienceLevel = "1-3 Years",
    interviewTypes = ["technical"],
    primarySkills = null,
    secondarySkills = null,
  }) {
    const band = bandForYears(parseExperienceLevel(experienceLevel)) || EXPERIENCE_BANDS.JUNIOR;

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

    // 3. Technical skills for this role: ranked by evidence + role relevance,
    // backfilled with general competencies in an experience-appropriate order.
    const rankedTopics = ResumeTopicService.rankSkills({
      role,
      candidateSkills,
      primarySkills,
      secondarySkills,
    }).map((s) => s.topic);
    const getTechnicalSkills = (count) => ResumeTopicService.fillTechnicalSlots(rankedTopics, count, band);

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
