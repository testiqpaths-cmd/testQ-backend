import { createRequire } from "module";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const require = createRequire(import.meta.url);

let pdfPkg = null;
try {
  pdfPkg = require("pdf-parse");
} catch {
  // Handled dynamically on first pdf parse
}

let mammothPkg = null;
try {
  mammothPkg = require("mammoth");
} catch {
  // Handled dynamically on first docx parse
}

import { aiService } from "../ai/ai.service.js";

// Comprehensive catalog of modern technical skills and frameworks across domains
const EXTENDED_SKILLS_DICTIONARY = [
  // Languages
  "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "C", "Go", "Rust", "PHP", "Ruby",
  "Kotlin", "Swift", "Dart", "Scala", "R", "Elixir", "Solidity", "Shell", "Bash", "SQL",
  // Frontend
  "React", "Angular", "Vue", "Next.js", "Nuxt", "Svelte", "HTML", "CSS", "TailwindCSS", "Bootstrap",
  "Sass", "Redux", "Zustand", "MobX", "Webpack", "Vite", "GraphQL", "jQuery",
  // Backend & APIs
  "Node.js", "Express", "NestJS", "FastAPI", "Django", "Flask", "Spring Boot", "Spring",
  "ASP.NET", ".NET", "Ruby on Rails", "Laravel", "Gin", "Echo", "Koa", "REST", "gRPC", "WebSocket",
  // Mobile
  "Flutter", "React Native", "Android", "iOS", "SwiftUI", "Jetpack Compose",
  // Databases & Caching
  "PostgreSQL", "MongoDB", "MySQL", "Redis", "Elasticsearch", "SQLite", "DynamoDB", "Cassandra",
  "Prisma", "TypeORM", "Mongoose", "SQLAlchemy", "Hibernate", "Supabase", "Firebase",
  // Cloud & DevOps
  "Docker", "Kubernetes", "AWS", "Azure", "GCP", "CI/CD", "GitHub Actions", "GitLab CI", "Jenkins",
  "Terraform", "Ansible", "Linux", "Nginx", "Apache", "Kafka", "RabbitMQ", "Celery", "Git",
  "S3", "EC2", "Lambda", "Cloudflare",
  // AI, Data & Testing
  "Pandas", "NumPy", "PyTorch", "TensorFlow", "Scikit-learn", "OpenCV", "Jest", "Mocha",
  "Cypress", "Playwright", "Selenium", "JUnit", "Pytest", "Microservices", "System Design"
];

export class ResumeParserService {
  constructor(ai = aiService) {
    this.ai = ai;
  }

  /**
   * Parse uploaded resume buffer based on MIME type or filename.
   * Supports PDF, DOCX, and plain text.
   * @param {Object} file - Express multer file object { buffer, mimetype, originalname, size }
   * @returns {Promise<{ rawText: string, filename: string, sizeBytes: number, extracted: Object }>}
   */
  async parseResumeFile(file, options = {}) {
    if (!file || !file.buffer) {
      throw new ApiError(400, "No resume file provided.");
    }

    const { mimetype, originalname, size, buffer } = file;
    const extension = (originalname || "").split(".").pop().toLowerCase();

    logger.info(`Parsing resume: ${originalname} (${mimetype}, ${size} bytes)`);

    let rawText = "";

    try {
      if (mimetype === "application/pdf" || extension === "pdf") {
        if (!pdfPkg) {
          try {
            pdfPkg = require("pdf-parse");
          } catch (e) {
            throw new ApiError(500, `PDF parser unavailable in this environment: ${e.message}`);
          }
        }
        if (pdfPkg?.PDFParse) {
          const parser = new pdfPkg.PDFParse({ data: buffer });
          const textResult = await parser.getText();
          rawText = typeof textResult === "string" ? textResult : textResult?.text || "";
          if (parser.destroy) await parser.destroy();
        } else if (typeof pdfPkg === "function") {
          const data = await pdfPkg(buffer);
          rawText = data?.text || "";
        }
      } else if (
        mimetype ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        extension === "docx"
      ) {
        if (!mammothPkg) {
          try {
            mammothPkg = (await import("mammoth")).default || (await import("mammoth"));
          } catch {
            throw new ApiError(500, "DOCX parser (mammoth) is not available.");
          }
        }
        const result = await mammothPkg.extractRawText({ buffer });
        rawText = result.value || "";
      } else if (
        mimetype === "text/plain" ||
        extension === "txt"
      ) {
        rawText = buffer.toString("utf-8");
      } else {
        throw new ApiError(
          400,
          `Unsupported resume file format (.${extension}). Please upload a PDF or DOCX file.`
        );
      }
    } catch (err) {
      logger.error(`Resume file parsing failed: ${err.message}`);
      if (err instanceof ApiError) throw err;
      throw new ApiError(422, `Failed to parse resume content: ${err.message}`);
    }

    if (!rawText.trim()) {
      throw new ApiError(
        422,
        "Uploaded resume appears to be empty or unreadable text."
      );
    }

    // Extract rich, evidence-grounded candidate profile
    const extracted = await this.extractStructuredProfile(rawText, options);

    return {
      rawText: rawText.trim(),
      filename: originalname,
      sizeBytes: size,
      extracted,
    };
  }

  /**
   * Primary profile extractor: attempts AI-assisted extraction if available,
   * falling back reliably to multi-section deterministic extraction.
   * @param {string} text
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async extractStructuredProfile(text, options = {}) {
    // If running in test environment (unless useAi is explicitly enabled), or useAi is false,
    // bypass remote network requests to ensure instantaneous, deterministic test execution.
    const skipAi =
      options.useAi === false ||
      (process.env.NODE_ENV === "test" && options.useAi !== true);

    if (!skipAi && this.ai && typeof this.ai.getApiKey === "function" && this.ai.getApiKey()) {
      try {
        const aiProfile = await this.extractWithAi(text);
        if (aiProfile && Array.isArray(aiProfile.skills) && aiProfile.skills.length > 0) {
          return this.normalizeProfile(aiProfile, text);
        }
      } catch (err) {
        logger.warn(`AI resume extraction exception: ${err.message}. Falling back to deterministic parser.`);
      }
    }

    // 2. Deterministic multi-section entity & project extraction fallback
    return this.extractEntitiesFromText(text);
  }

  /**
   * AI-powered structured candidate profile extraction
   * @param {string} text
   */
  async extractWithAi(text) {
    const systemPrompt = `You are an expert technical resume auditor and extraction engine.
Analyze the candidate's resume text and extract a strictly grounded, factual candidate profile.
CRITICAL MANDATES:
1. DO NOT fabricate, guess, or inject skills, technologies, or projects not explicitly mentioned in the text.
2. Distinguish between technologies actively used in projects/experience (primarySkills) versus those merely listed in a skills summary (secondarySkills).
3. Extract projects with their claimed architecture, technologies used, and candidate contributions.
4. Provide an exact evidenceSnippet (quote from resume) showing where key claims originated.
5. Return ONLY a valid JSON object matching this exact schema:
{
  "primarySkills": ["string"],
  "secondarySkills": ["string"],
  "skills": ["string"],
  "detectedExperienceYears": number,
  "summaryPreview": "string",
  "experience": [
    {
      "role": "string",
      "company": "string",
      "duration": "string",
      "responsibilities": ["string"],
      "technologies": ["string"]
    }
  ],
  "projects": [
    {
      "title": "string",
      "description": "string",
      "technologies": ["string"],
      "architecture": "string",
      "contributions": ["string"],
      "evidenceSnippet": "string"
    }
  ],
  "evidenceSnippets": {
    "SkillOrClaim": "Exact sentence quote from resume"
  }
}`;

    const boundedText = text.slice(0, 15000);
    const userPrompt = `Extract the structured candidate profile from this resume:\n\n${boundedText}`;

    return await this.ai.generateStructuredJson({
      systemPrompt,
      userPrompt,
      meta: { purpose: "resume_extraction" },
    });
  }

  /**
   * Deterministic entity and project extraction across resume sections.
   * Recognizes technologies beyond fixed lists, parses projects, and creates evidence snippets.
   * @param {string} text
   */
  extractEntitiesFromText(text) {
    const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lowerText = text.toLowerCase();

    // 1. Identify skills from the extended dictionary with ambiguity protection
    const matchedDictionarySkills = EXTENDED_SKILLS_DICTIONARY.filter((skill) => {
      const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

      // Short / ambiguous tokens require strict case-matching or explicit tech terms
      // to prevent false positives from everyday English words (e.g. "ready to go", "c. 2020")
      if (skill === "Go") {
        const hasGolang = /\bGolang\b/i.test(text);
        const hasCapitalizedGo = /(^|[^a-zA-Z0-9_#+])Go([^a-zA-Z0-9_#+]|$)/.test(text);
        const inTechContext = /(?:skills|technologies|languages|stack|developer|engineer|backend|microservices)/i.test(text);
        return hasGolang || (hasCapitalizedGo && inTechContext);
      }
      if (skill === "C" || skill === "R") {
        const strictListContext = new RegExp(`(^|[,|•·;/(])\\s*${escaped}\\s*([,|•·;/)]|$)`);
        return strictListContext.test(text);
      }

      const regex = new RegExp(`(^|[^a-zA-Z0-9_#+])${escaped}([^a-zA-Z0-9_#+]|$)`, "i");
      return regex.test(text);
    });

    // 2. Section parsing: split into logical sections (Skills, Projects, Experience)
    const sections = this.partitionSections(rawLines);

    // 3. Dynamic skills extraction from explicit "Skills" sections (captures unfamiliar tools)
    const dynamicSkills = this.extractDynamicSkillsFromSection(sections.skills);
    
    // Union of dictionary skills and dynamically found skills
    const allSkillsMap = new Map();
    matchedDictionarySkills.forEach((s) => allSkillsMap.set(s.toLowerCase(), s));
    dynamicSkills.forEach((s) => {
      if (!allSkillsMap.has(s.toLowerCase())) {
        allSkillsMap.set(s.toLowerCase(), s);
      }
    });

    const allSkills = Array.from(allSkillsMap.values());

    // 4. Project extraction
    const projects = this.extractProjectsFromSection(sections.projects, rawLines, allSkills);

    // 5. Work experience extraction
    const experience = this.extractExperienceFromSection(sections.experience);

    // 6. Partition into primary vs secondary skills
    // Skills appearing in projects or experience are primary; others are secondary.
    const projectAndExpText = [
      ...projects.map((p) => `${p.title} ${p.description} ${(p.technologies || []).join(" ")}`),
      ...experience.map((e) => `${e.role} ${e.company} ${(e.responsibilities || []).join(" ")} ${(e.technologies || []).join(" ")}`),
    ].join(" ").toLowerCase();

    const primarySkills = [];
    const secondarySkills = [];

    allSkills.forEach((skill) => {
      const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const inProjectsOrExp = new RegExp(`\\b${escaped}\\b`, "i").test(projectAndExpText);
      if (inProjectsOrExp || projects.some((p) => (p.technologies || []).some((t) => t.toLowerCase() === skill.toLowerCase()))) {
        primarySkills.push(skill);
      } else {
        secondarySkills.push(skill);
      }
    });

    // 7. Evidence Snippets: locate where each skill appeared in the resume
    const evidenceSnippets = {};
    allSkills.forEach((skill) => {
      const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      const matchedLine = rawLines.find((line) => regex.test(line));
      if (matchedLine) {
        evidenceSnippets[skill] = matchedLine.slice(0, 160);
      }
    });

    // 8. Experience duration detection
    let detectedYears = 0;
    const expRegex = /(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+experience/i;
    const match = text.match(expRegex);
    if (match) {
      detectedYears = parseInt(match[1], 10) || 0;
    }

    return {
      skills: allSkills.length > 0 ? allSkills : matchedDictionarySkills,
      primarySkills: primarySkills.length > 0 ? primarySkills : allSkills,
      secondarySkills,
      detectedExperienceYears: detectedYears,
      summaryPreview: rawLines.slice(0, 5).join(" "),
      projects,
      experience,
      evidenceSnippets,
    };
  }

  /**
   * Normalizes and bounds AI profile output to ensure safe execution
   */
  normalizeProfile(profile, originalText) {
    const rawSkills = Array.isArray(profile.skills) ? profile.skills : [];
    const primarySkills = Array.isArray(profile.primarySkills) ? profile.primarySkills : rawSkills;
    const secondarySkills = Array.isArray(profile.secondarySkills) ? profile.secondarySkills : [];
    const combinedSkills = Array.from(new Set([...primarySkills, ...secondarySkills, ...rawSkills]))
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const projects = Array.isArray(profile.projects)
      ? profile.projects.map((p) => ({
          title: String(p.title || "Project").trim(),
          description: String(p.description || "").trim().slice(0, 500),
          technologies: Array.isArray(p.technologies) ? p.technologies.map((t) => String(t).trim()).filter(Boolean) : [],
          architecture: String(p.architecture || "").trim().slice(0, 200),
          contributions: Array.isArray(p.contributions) ? p.contributions.map((c) => String(c).trim()).filter(Boolean) : [],
          evidenceSnippet: String(p.evidenceSnippet || "").trim().slice(0, 250),
        }))
      : [];

    const experience = Array.isArray(profile.experience)
      ? profile.experience.map((e) => ({
          role: String(e.role || "").trim(),
          company: String(e.company || "").trim(),
          duration: String(e.duration || "").trim(),
          responsibilities: Array.isArray(e.responsibilities) ? e.responsibilities.map((r) => String(r).trim()).filter(Boolean) : [],
          technologies: Array.isArray(e.technologies) ? e.technologies.map((t) => String(t).trim()).filter(Boolean) : [],
        }))
      : [];

    const evidenceSnippets = profile.evidenceSnippets && typeof profile.evidenceSnippets === "object"
      ? profile.evidenceSnippets
      : {};

    const rawLines = originalText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    return {
      skills: combinedSkills,
      primarySkills: primarySkills.length > 0 ? primarySkills : combinedSkills,
      secondarySkills,
      detectedExperienceYears: typeof profile.detectedExperienceYears === "number" ? profile.detectedExperienceYears : 0,
      summaryPreview: String(profile.summaryPreview || rawLines.slice(0, 4).join(" ")).trim(),
      projects,
      experience,
      evidenceSnippets,
    };
  }

  /**
   * Partitions lines into major resume sections
   */
  partitionSections(lines) {
    const sections = {
      skills: [],
      projects: [],
      experience: [],
      other: [],
    };

    let currentSection = "other";

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (/^(?:technical\s+skills|skills|skills\s*&|technologies|core\s+competencies|tools\s*&)/i.test(lower)) {
        currentSection = "skills";
        continue;
      } else if (/^(?:projects|academic\s+projects|personal\s+projects|key\s+projects|selected\s+projects)/i.test(lower)) {
        currentSection = "projects";
        continue;
      } else if (/^(?:work\s+experience|experience|employment\s+history|professional\s+experience)/i.test(lower)) {
        currentSection = "experience";
        continue;
      } else if (/^(?:education|certifications|awards|publications|interests)/i.test(lower)) {
        currentSection = "other";
        continue;
      }

      sections[currentSection].push(line);
    }

    return sections;
  }

  /**
   * Extracts dynamically declared skills from the Skills section
   */
  extractDynamicSkillsFromSection(lines) {
    const tokens = new Set();
    for (const line of lines) {
      // Split on commas, pipes, bullets, slashes
      const parts = line.replace(/^[A-Za-z\s]+:\s*/, "").split(/[,|•·;–—\t\/]/);
      for (let part of parts) {
        part = part.trim().replace(/^[-*•\s]+/, "").trim();
        // Discard sentence-long descriptions or very short noise
        if (part && part.length >= 2 && part.length <= 30 && !/\b(?:and|with|the|using|for|etc)\b/i.test(part)) {
          tokens.add(part);
        }
      }
    }
    return Array.from(tokens);
  }

  /**
   * Parses project blocks from the Projects section
   */
  extractProjectsFromSection(projectLines, allLines, allSkills) {
    const projects = [];
    if (!projectLines || projectLines.length === 0) {
      // Fallback: look for "Project:" or "Project -" patterns in all lines
      return this.findProjectsInAllLines(allLines, allSkills);
    }

    let currentProject = null;

    for (const line of projectLines) {
      // New project detection: heading or bullet with title
      const isHeader = /^([A-Z0-9][A-Za-z0-9\s\-_]{2,40})(?:\s*[:|\-–]\s*(.*))?$/.test(line) && !line.includes("•");
      if (isHeader && line.length < 60) {
        if (currentProject) projects.push(currentProject);
        const match = line.match(/^([A-Z0-9][A-Za-z0-9\s\-_]{2,40})(?:\s*[:|\-–]\s*(.*))?$/);
        currentProject = {
          title: (match?.[1] || line).trim(),
          description: (match?.[2] || "").trim(),
          technologies: [],
          architecture: "",
          contributions: [],
          evidenceSnippet: line,
        };
        continue;
      }

      if (!currentProject) {
        currentProject = {
          title: line.slice(0, 40),
          description: "",
          technologies: [],
          architecture: "",
          contributions: [],
          evidenceSnippet: line,
        };
      } else {
        // Look for tech stack declarations like "Tech Stack: Python, Django, AWS"
        const techMatch = line.match(/(?:tech(?:nologies|\s+stack)?|tools|stack):\s*(.*)/i);
        if (techMatch) {
          const foundTech = techMatch[1].split(/[,|•·;]/).map((t) => t.trim()).filter(Boolean);
          currentProject.technologies.push(...foundTech);
        } else {
          currentProject.description = (currentProject.description ? currentProject.description + " " : "") + line;
          currentProject.contributions.push(line);
        }
      }
    }

    if (currentProject) projects.push(currentProject);

    // Cross-reference extracted project descriptions with allSkills to attach matching technologies
    projects.forEach((proj) => {
      const projText = `${proj.title} ${proj.description}`.toLowerCase();
      allSkills.forEach((skill) => {
        const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`, "i").test(projText)) {
          if (!proj.technologies.some((t) => t.toLowerCase() === skill.toLowerCase())) {
            proj.technologies.push(skill);
          }
        }
      });
      proj.evidenceSnippet = proj.description.slice(0, 200) || proj.title;
    });

    return projects.slice(0, 5); // Bound to top 5 projects
  }

  findProjectsInAllLines(lines, allSkills) {
    const projects = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/project\s*[:\-–]\s*(.*)/i.test(line) || /^[A-Z][a-zA-Z0-9\s]{2,25}\s*\((?:Python|React|Flutter|Node|Java|Django).*\)/i.test(line)) {
        const nextLines = lines.slice(i + 1, i + 4).join(" ");
        const projTech = allSkills.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(`${line} ${nextLines}`));
        projects.push({
          title: line.replace(/project\s*[:\-–]\s*/i, "").trim().slice(0, 50),
          description: nextLines.slice(0, 300),
          technologies: projTech,
          architecture: "",
          contributions: [nextLines.slice(0, 200)],
          evidenceSnippet: line.slice(0, 160),
        });
        if (projects.length >= 3) break;
      }
    }
    return projects;
  }

  extractExperienceFromSection(experienceLines) {
    const experiences = [];
    let current = null;

    for (const line of experienceLines) {
      if (/^[A-Z0-9][A-Za-z0-9\s\-_]{2,40}(?:at|@|,)\s*[A-Za-z0-9\s\-_]+/i.test(line)) {
        if (current) experiences.push(current);
        current = {
          role: line.split(/at|@|,/i)[0].trim(),
          company: (line.split(/at|@|,/i)[1] || "").trim(),
          duration: "",
          responsibilities: [],
          technologies: [],
        };
        continue;
      }

      if (current) {
        current.responsibilities.push(line);
      }
    }

    if (current) experiences.push(current);
    return experiences.slice(0, 5);
  }
}

export const resumeParserService = new ResumeParserService();
export default resumeParserService;
