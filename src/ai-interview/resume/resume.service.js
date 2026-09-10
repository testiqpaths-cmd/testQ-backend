import { resumeParserService } from "./resume-parser.service.js";
import { resumeTopicService } from "./resume-topic.service.js";

export class ResumeService {
  constructor(parser = resumeParserService, topicSelector = resumeTopicService) {
    this.parser = parser;
    this.topicSelector = topicSelector;
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
}

export const resumeService = new ResumeService();
export default resumeService;
