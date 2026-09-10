import { interviewSessionService } from "../services/interview-session.service.js";
import { answerAnalysisService } from "../services/answer-analysis.service.js";
import { resumeService } from "../resume/resume.service.js";
import { resumeTopicService } from "../resume/resume-topic.service.js";
import logger from "../../config/logger.js";

export class AiInterviewController {
  /**
   * POST /ai-interview/custom & POST /ai-interview/sessions
   * Path B: Set up custom interview
   */
  async createCustomInterview(req, res, next) {
    try {
      const result = await interviewSessionService.createCustomInterview(
        req.user._id,
        req.body
      );
      return res.status(201).json({
        success: true,
        message: "Interview session created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/resume
   * Path A: Interview with resume (file upload or data)
   */
  async createResumeInterview(req, res, next) {
    try {
      const result = await interviewSessionService.createResumeInterview(
        req.user._id,
        req.file,
        req.body
      );
      return res.status(201).json({
        success: true,
        message: "Resume interview created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/:id/start & POST /ai-interview/sessions/:id/start
   * Start interview session and generate the first question
   */
  async startInterview(req, res, next) {
    try {
      const result = await interviewSessionService.startInterview(
        req.params.id,
        req.user
      );
      return res.status(200).json({
        success: true,
        message: "Interview started successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/:id/answer & POST /ai-interview/sessions/:id/answers
   * Submit and persist candidate answer for the current question turn
   */
  async submitAnswer(req, res, next) {
    try {
      const result = await interviewSessionService.submitAnswer(
        req.params.id,
        req.user,
        req.body
      );
      return res.status(200).json({
        success: true,
        message: "Answer submitted successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/:id/analyze-answer & POST /ai-interview/sessions/:id/analyze-answer
   * Explicit endpoint to trigger answer analysis for active turn
   */
  async analyzeAnswer(req, res, next) {
    try {
      const result = await answerAnalysisService.analyzeTurnAnswer({
        sessionId: req.params.id,
        user: req.user,
        turnId: req.body?.turnId || req.body?.questionId,
      });
      return res.status(200).json({
        success: true,
        message: "Answer analyzed successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/:id/next & POST /ai-interview/sessions/:id/next
   * Determine and execute the next adaptive interview action
   */
  async nextAction(req, res, next) {
    try {
      const result = await interviewSessionService.processNextAction(
        req.params.id,
        req.user
      );
      return res.status(200).json({
        success: true,
        message: "Next action processed successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/resume/upload & POST /ai-interview/resume/:id/analyze
   * Parse resume and extract detected skills/relevance without immediately starting session
   */
  async parseResumeOnly(req, res, next) {
    try {
      const processed = await resumeService.processResume(req.file, {
        role: req.body?.role || "Software Engineer",
        duration: Number(req.body?.duration || 30),
      });

      return res.status(200).json({
        success: true,
        data: {
          resumeId: `resume-${Date.now()}`,
          filename: processed.filename,
          sizeBytes: processed.sizeBytes,
          skills: processed.extracted.skills,
          experienceYears: processed.extracted.detectedExperienceYears,
          summaryPreview: processed.extracted.summaryPreview,
          recommendedTopics: processed.scopedTopics,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/:id & GET /ai-interview/sessions/:id
   * Get session status, current question state, plan, and ownership validation
   */
  async getSession(req, res, next) {
    try {
      const session = await interviewSessionService.getSessionById(
        req.params.id,
        req.user
      );
      return res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/history
   * List candidate's past and active interview sessions
   */
  async getHistory(req, res, next) {
    try {
      const history = await interviewSessionService.getUserSessions(
        req.user._id,
        req.query
      );
      return res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/recommendation
   * Generate recommended setup for target role
   */
  async getRecommendedSetup(req, res, next) {
    try {
      const role = req.body?.role || req.body?.roles?.[0] || "Frontend Developer";
      const topics = resumeTopicService.selectInterviewTopics({
        role,
        duration: Number(req.body?.duration || 30),
      });

      return res.status(200).json({
        success: true,
        data: {
          role,
          difficulty: "ADAPTIVE",
          durationMinutes: 30,
          interviewTypes: ["technical", "behavioral"],
          recommendedTopics: topics,
          techStack: topics,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const aiInterviewController = new AiInterviewController();
export default aiInterviewController;
