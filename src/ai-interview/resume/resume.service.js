import crypto from "crypto";
import { resumeParserService } from "./resume-parser.service.js";
import { resumeTopicService } from "./resume-topic.service.js";
import { Resume } from "../schemas/resume.schema.js";
import { uploadBufferToCloudinary } from "../../common/utils/cloudinary.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const RAW_TEXT_CAP = 20000;
const RESUME_FOLDER = "ai-interview/resumes";

const contentHashOf = (rawText) =>
  crypto
    .createHash("sha256")
    .update(String(rawText || "").trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");

export class ResumeService {
  constructor(parser = resumeParserService, topicSelector = resumeTopicService) {
    this.parser = parser;
    this.topicSelector = topicSelector;
  }

  generateResumeId() {
    return `resume-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Parse resume file and calculate scoped topics for the target role
   * @param {Object} file - Uploaded file from multer
   * @param {Object} options - Options { role, duration, experienceLevel }
   */
  async processResume(file, options = {}) {
    const parsed = await this.parser.parseResumeFile(file);

    const scopedTopics = this.topicSelector.selectInterviewTopics({
      role: options.role || "Software Engineer",
      candidateSkills: parsed.extracted.skills,
      duration: options.duration || 30,
      experienceLevel: options.experienceLevel || "1-3 Years",
    });

    return {
      filename: parsed.filename,
      sizeBytes: parsed.sizeBytes,
      rawText: parsed.rawText,
      extracted: parsed.extracted,
      scopedTopics,
    };
  }

  /**
   * Same parse+scope work as processResume, plus persistence — so a later
   * GET can return the saved resume, and an interview can be created from
   * a resumeId instead of always re-uploading the file.
   */
  async uploadAndSaveResume(userId, file, options = {}) {
    const processed = await this.processResume(file, options);
    const contentHash = contentHashOf(processed.rawText);

    // Same resume, same user, already stored -> reuse it. Skips a second
    // Cloudinary upload and a duplicate DB row.
    const existing = await Resume.findOne({ userId, contentHash }).lean();
    if (existing) {
      logger.info(`Resume ${existing.resumeId} reused for user ${userId} (content hash match)`);
      return this.toDto(existing);
    }

    const resumeId = this.generateResumeId();

    // Store the original file (raw resource type for PDF/DOCX). Non-fatal:
    // parsing/topics is the critical path.
    let fileUrl = null;
    let filePublicId = null;
    if (file?.buffer) {
      try {
        const up = await uploadBufferToCloudinary(file.buffer, file.mimetype, RESUME_FOLDER, {
          resource_type: "raw",
          public_id: resumeId,
        });
        fileUrl = up.secure_url;
        filePublicId = up.public_id;
      } catch (err) {
        logger.warn(`Resume file upload to Cloudinary failed (non-fatal): ${err.message}`);
      }
    }

    const doc = await Resume.create({
      userId,
      resumeId,
      filename: processed.filename,
      sizeBytes: processed.sizeBytes,
      mimetype: file?.mimetype,
      fileUrl,
      filePublicId,
      contentHash,
      rawText: (processed.rawText || "").slice(0, RAW_TEXT_CAP),
      extracted: processed.extracted,
      scopedTopics: processed.scopedTopics,
    });

    return this.toDto(doc);
  }

  toDto(doc) {
    return {
      resumeId: doc.resumeId,
      filename: doc.filename,
      sizeBytes: doc.sizeBytes,
      fileUrl: doc.fileUrl || null,
      skills: doc.extracted?.skills || [],
      experienceYears: doc.extracted?.detectedExperienceYears || 0,
      summaryPreview: doc.extracted?.summaryPreview || "",
      recommendedTopics: doc.scopedTopics || [],
      uploadedAt: doc.createdAt,
    };
  }

  /**
   * Most recent resume uploaded by this user, or null if they've never
   * uploaded one. Shaped identically to uploadAndSaveResume's return value
   * plus uploadedAt, so callers (GET /resume) can treat both the same way.
   */
  async getLatestForUser(userId) {
    const doc = await Resume.findOne({ userId }).sort({ createdAt: -1 }).lean();
    return doc ? this.toDto(doc) : null;
  }

  /**
   * Looks up a specific saved resume by resumeId, scoped to its owner —
   * used when creating a resume-based interview from a previously uploaded
   * resume instead of a fresh file.
   */
  async getByResumeId(userId, resumeId) {
    const doc = await Resume.findOne({ resumeId, userId }).lean();
    if (!doc) {
      throw new ApiError(404, `Saved resume not found: ${resumeId}`);
    }
    return doc;
  }
}

export const resumeService = new ResumeService();
export default resumeService;
