import express from "express";
import { authMiddleware } from "../common/middlewares/auth.middleware.js";
import { validate } from "../common/middlewares/validate.middleware.js";
import { createCustomInterviewSchema } from "./dto/create-interview.dto.js";
import { submitAnswerSchema } from "./dto/submit-answer.dto.js";
import { aiInterviewController } from "./controllers/ai-interview.controller.js";
import { resumeUpload } from "./middlewares/resume-upload.middleware.js";

const router = express.Router();

// All AI Interview routes require authentication
router.use(authMiddleware);

// Path B: Set up custom interview
router.post(
  "/custom",
  validate(createCustomInterviewSchema),
  aiInterviewController.createCustomInterview
);

// Alias for frontend compatibility (POST /ai-interview/sessions)
router.post(
  "/sessions",
  validate(createCustomInterviewSchema),
  aiInterviewController.createCustomInterview
);

// Path A: Set up interview with resume upload
router.post(
  "/resume",
  resumeUpload.single("resume"),
  aiInterviewController.createResumeInterview
);

// Resume standalone upload & analysis (used by resume flow before session launch)
router.post(
  "/resume/upload",
  resumeUpload.single("resume"),
  aiInterviewController.parseResumeOnly
);

router.post(
  "/resume/:id/analyze",
  aiInterviewController.parseResumeOnly
);

// Recommendations
router.post(
  "/recommendation",
  aiInterviewController.getRecommendedSetup
);

// Candidate interview history
router.get(
  "/history",
  aiInterviewController.getHistory
);

// Start interview session & generate first question
router.post(
  "/sessions/:id/start",
  aiInterviewController.startInterview
);

router.post(
  "/:id/start",
  aiInterviewController.startInterview
);

// Submit answer for active question turn
router.post(
  "/sessions/:id/answers",
  validate(submitAnswerSchema),
  aiInterviewController.submitAnswer
);

router.post(
  "/sessions/:id/answer",
  validate(submitAnswerSchema),
  aiInterviewController.submitAnswer
);

router.post(
  "/:id/answer",
  validate(submitAnswerSchema),
  aiInterviewController.submitAnswer
);

// Trigger answer analysis for active turn
router.post(
  "/sessions/:id/analyze-answer",
  aiInterviewController.analyzeAnswer
);

router.post(
  "/:id/analyze-answer",
  aiInterviewController.analyzeAnswer
);

// Next Action / Adaptive Turn Transition
router.post(
  "/sessions/:id/next",
  aiInterviewController.nextAction
);

router.post(
  "/:id/next",
  aiInterviewController.nextAction
);

// Session state & details
router.get(
  "/sessions/:id",
  aiInterviewController.getSession
);

router.get(
  "/:id",
  aiInterviewController.getSession
);

export default router;
