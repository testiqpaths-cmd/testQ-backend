import express from "express";
import { authMiddleware } from "../common/middlewares/auth.middleware.js";
import { validate } from "../common/middlewares/validate.middleware.js";
import { createCustomInterviewSchema } from "./dto/create-interview.dto.js";
import { resumeInterviewSchema } from "./dto/resume-interview.dto.js";
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

// Path A: Set up interview with resume — accepts either a multipart file
// upload (`resume` field) or a JSON body with `resumeId` pointing at a
// previously uploaded resume. resumeUpload.single() passes non-multipart
// requests straight through, so one route serves both.
router.post(
  "/resume",
  resumeUpload.single("resume"),
  validate(resumeInterviewSchema),
  aiInterviewController.createResumeInterview
);

// Resume standalone upload & analysis (used by the resume flow before
// session launch) — returns full analysis AND persists the resume.
router.post(
  "/resume/upload",
  resumeUpload.single("resume"),
  aiInterviewController.parseResumeOnly
);

// Recommendations
router.post("/recommendation", aiInterviewController.getRecommendedSetup);

// Aggregated dashboard across the candidate's completed interviews
// (single-segment path — must precede the "/:id" catch-all below)
router.get("/dashboard", aiInterviewController.getDashboard);

// Most recently uploaded resume for this candidate
router.get("/resume", aiInterviewController.getSavedResume);

// Candidate interview history
router.get("/history", aiInterviewController.getHistory);

// Start interview session & generate first question
router.post("/sessions/:id/start", aiInterviewController.startInterview);
router.post("/:id/start", aiInterviewController.startInterview);

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
router.post("/sessions/:id/analyze-answer", aiInterviewController.analyzeAnswer);
router.post("/:id/analyze-answer", aiInterviewController.analyzeAnswer);

// Next Action / Adaptive Turn Transition
router.post("/sessions/:id/next", aiInterviewController.nextAction);
router.post("/:id/next", aiInterviewController.nextAction);

// Force-finish an interview and return its scored results
router.post("/sessions/:id/complete", aiInterviewController.completeInterview);
router.post("/:id/complete", aiInterviewController.completeInterview);

// Full scored results + per-question feedback for a completed interview
// (more specific than "/:id" — must precede it)
router.get("/sessions/:id/details", aiInterviewController.getInterviewResults);
router.get("/:id/details", aiInterviewController.getInterviewResults);

// Session state
router.get("/sessions/:id", aiInterviewController.getSession);
router.get("/:id", aiInterviewController.getSession);

export default router;
