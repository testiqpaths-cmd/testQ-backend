import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import {
  getAllCompanies,
  getAllCompaniesForManagement,
  createCompany,
  updateCompany,
  deleteCompany,
} from "./company.controller.js";
import { createCompanySchema, updateCompanySchema } from "./company.schema.js";

const router = Router();

// Listing companies is unrestricted for every authenticated role (same as
// GET /subject-topic/subjects) — only actually filtering by company is a
// gated action, enforced separately by companyWiseFeatureMiddleware where
// companyIds are used (test creation, question listing).
router.get("/", authMiddleware, getAllCompanies);

// Managing the master Company list (create/edit/delete, and seeing inactive
// ones) is a separate, permission-gated capability — COMPANY_MANAGEMENT,
// same pattern as USER_MANAGEMENT/QUESTION_BANK. Fails open (allowed) for
// any plan with no PlanFeature row mapped to this key, same as every other
// featureMiddleware-gated route; seeded explicitly disabled for STUDENT
// plans and enabled for ORGANIZATION plans (see
// src/database/migrations/seed-company-management-feature.js).
router.get("/manage", authMiddleware, featureMiddleware("COMPANY_MANAGEMENT"), getAllCompaniesForManagement);
router.post("/", authMiddleware, featureMiddleware("COMPANY_MANAGEMENT"), validate(createCompanySchema), createCompany);
router.put("/:id", authMiddleware, featureMiddleware("COMPANY_MANAGEMENT"), validate(updateCompanySchema), updateCompany);
router.delete("/:id", authMiddleware, featureMiddleware("COMPANY_MANAGEMENT"), deleteCompany);

export default router;
