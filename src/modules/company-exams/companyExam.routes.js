import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import {
  getCompanies,
  getCompanyTracks,
  getCompanyResults,
} from "./companyExam.controller.js";

const router = Router();

// Student Company Exam portal endpoints
router.get("/companies", authMiddleware, getCompanies);
router.get("/company/:slug/tracks", authMiddleware, getCompanyTracks);
router.get("/results", authMiddleware, getCompanyResults);

export default router;
