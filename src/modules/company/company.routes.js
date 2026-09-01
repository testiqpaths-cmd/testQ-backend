import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { getAllCompanies } from "./company.controller.js";

const router = Router();

// Listing companies is unrestricted for every authenticated role (same as
// GET /subject-topic/subjects) — only actually filtering by company is a
// gated action, enforced separately by companyWiseFeatureMiddleware where
// companyIds are used (test creation, question listing).
router.get("/", authMiddleware, getAllCompanies);

export default router;
