import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import {
  getCompanies,
  getCompanyTracks,
  getCompanyResults,
  startCompanyTrackAttempt,
  getCompanyTrackAttempt,
  getCompanyTrackAttemptById,
  getCompanyTrackAdminAnalytics,
  retakeCompanyTrackAttempt,
  launchCompanyInterviewRound,
} from "./companyExam.controller.js";

const router = Router();

// Student Company Exam portal endpoints
router.get("/companies", authMiddleware, getCompanies);
router.get("/company/:slug/tracks", authMiddleware, getCompanyTracks);
router.get("/results", authMiddleware, getCompanyResults);

// Admin & Organization Company Track Analytics
router.get(
  "/admin/analytics",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"),
  getCompanyTrackAdminAnalytics
);

// Individual track attempt detail with ownership enforcement
router.get("/attempts/:attemptId", authMiddleware, getCompanyTrackAttemptById);

// Track attempt and progression lifecycle endpoints
router.post("/tracks/:trackId/start", authMiddleware, startCompanyTrackAttempt);
router.get("/tracks/:trackId/attempt", authMiddleware, getCompanyTrackAttempt);
router.post("/tracks/:trackId/retake", authMiddleware, retakeCompanyTrackAttempt);

// AI Interview round launch endpoints
router.post("/tracks/:trackId/rounds/:roundOrder/interview/launch", authMiddleware, launchCompanyInterviewRound);
router.post("/tracks/:trackId/interview/launch", authMiddleware, launchCompanyInterviewRound);

export default router;
