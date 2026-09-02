import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import { getAllCompanies, createCompany, updateCompany, deleteCompany } from "./company.controller.js";
import { createCompanySchema, updateCompanySchema } from "./company.schema.js";

const router = Router();

// Same permission model as Subject/Topic (subject-topic.routes.js) — plain
// authMiddleware, no special feature gate. Companies are meant to be
// created implicitly (e.g. resolveOrCreateCompanyId during Excel question
// upload, same as resolveOrCreateSubjectId/TopicId), not managed through a
// dedicated admin screen.
router.get("/", authMiddleware, getAllCompanies);
router.post("/", authMiddleware, validate(createCompanySchema), createCompany);
router.put("/:id", authMiddleware, validate(updateCompanySchema), updateCompany);
router.delete("/:id", authMiddleware, deleteCompany);

export default router;
