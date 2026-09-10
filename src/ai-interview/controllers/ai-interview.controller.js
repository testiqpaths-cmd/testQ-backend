import { interviewSessionService } from "../services/interview-session.service.js";
import { answerAnalysisService } from "../services/answer-analysis.service.js";
import { interviewResultsService } from "../services/interview-results.service.js";
import { interviewDashboardService } from "../services/interview-dashboard.service.js";
import { interviewOrgService } from "../services/interview-org.service.js";
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
   * POST /ai-interview/resume/upload
   * Parse a resume, extract skills/topics, and persist it so it can be
   * reused later (GET /ai-interview/resume, or creating an interview from
   * a resumeId) without re-uploading the file.
   */
  async parseResumeOnly(req, res, next) {
    try {
      const data = await resumeService.uploadAndSaveResume(req.user._id, req.file, {
        role: req.body?.role || "Software Engineer",
        duration: Number(req.body?.duration || 30),
        experienceLevel: req.body?.experienceLevel,
      });

      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/resume
   * Returns the candidate's most recently uploaded resume, or null.
   */
  async getSavedResume(req, res, next) {
    try {
      const data = await resumeService.getLatestForUser(req.user._id);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/dashboard
   * Aggregated readiness/competency/stats view across the candidate's own
   * completed interviews.
   */
  async getDashboard(req, res, next) {
    try {
      const data = await interviewDashboardService.getDashboard(req.user._id);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/org/overview
   * Org/Admin: aggregate AI Interview stats + recent-interviews table for
   * the caller's in-scope students (org = own students, admin = all).
   */
  async getOrgOverview(req, res, next) {
    try {
      const data = await interviewOrgService.getOrgOverview(req.user, req.query);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/org/students/:studentId
   * Org/Admin: one student's interview list (org-scoped).
   */
  async getStudentInterviews(req, res, next) {
    try {
      const data = await interviewOrgService.getStudentInterviews(
        req.user,
        req.params.studentId
      );
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ai-interview/sessions/:id/details & GET /ai-interview/:id/details
   * Full scored results + per-question feedback for a completed interview.
   */
  async getInterviewResults(req, res, next) {
    try {
      const data = await interviewResultsService.getInterviewResults(
        req.params.id,
        req.user
      );
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ai-interview/sessions/:id/complete & POST /ai-interview/:id/complete
   * Force-finish an interview and return its scored results. Idempotent.
   */
  async completeInterview(req, res, next) {
    try {
      const data = await interviewSessionService.completeInterview(
        req.params.id,
        req.user
      );
      return res.status(200).json({ success: true, data });
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
