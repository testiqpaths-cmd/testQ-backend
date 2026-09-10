import { createRequire } from "module";
import mammoth from "mammoth";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const require = createRequire(import.meta.url);
const pdfPkg = require("pdf-parse");

export class ResumeParserService {
  /**
   * Parse uploaded resume buffer based on MIME type or filename.
   * Supports PDF, DOCX, and plain text.
   * @param {Object} file - Express multer file object { buffer, mimetype, originalname, size }
   * @returns {Promise<{ rawText: string, metadata: Object }>}
   */
  async parseResumeFile(file) {
    if (!file || !file.buffer) {
      throw new ApiError(400, "No resume file provided.");
    }

    const { mimetype, originalname, size, buffer } = file;
    const extension = (originalname || "").split(".").pop().toLowerCase();

    logger.info(`Parsing resume: ${originalname} (${mimetype}, ${size} bytes)`);

    let rawText = "";

    try {
      if (mimetype === "application/pdf" || extension === "pdf") {
        if (pdfPkg.PDFParse) {
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
        const result = await mammoth.extractRawText({ buffer });
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

    const extracted = this.extractEntitiesFromText(rawText);

    return {
      rawText: rawText.trim(),
      filename: originalname,
      sizeBytes: size,
      extracted,
    };
  }

  /**
   * Lightweight deterministic entity extraction for skills, experience, and contact info
   * @param {string} text
   */
  extractEntitiesFromText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // Common technical skills dictionary
    const KNOWN_SKILLS = [
      "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust", "PHP", "Ruby",
      "React", "Angular", "Vue", "Next.js", "Node.js", "Express", "NestJS", "Django", "Flask",
      "Spring Boot", "FastAPI", "MongoDB", "PostgreSQL", "MySQL", "Redis", "Elasticsearch",
      "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "GraphQL", "REST", "Microservices",
      "HTML", "CSS", "TailwindCSS", "Redux", "Kafka", "RabbitMQ", "CI/CD", "Linux", "SQL"
    ];

    const lowerText = text.toLowerCase();
    const matchedSkills = KNOWN_SKILLS.filter((skill) => {
      const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      return regex.test(lowerText);
    });

    // Detect approximate years of experience
    let detectedYears = 0;
    const expRegex = /(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+experience/i;
    const match = text.match(expRegex);
    if (match) {
      detectedYears = parseInt(match[1], 10) || 0;
    }

    return {
      skills: matchedSkills,
      detectedExperienceYears: detectedYears,
      summaryPreview: lines.slice(0, 5).join(" "),
    };
  }
}

export const resumeParserService = new ResumeParserService();
export default resumeParserService;
