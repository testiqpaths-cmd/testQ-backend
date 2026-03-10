import express from "express";
import { generateOrgReport } from "./orgReport.controller.js";
import { authMiddleware, roleMiddleware } from "../../../../common/middlewares/auth.middleware.js";

const router = express.Router();

// GET /reports/organization/:orgId?format=pdf|excel
router.get(
  "/organization/:orgId",
  authMiddleware,
  roleMiddleware("ORGANIZATION"), // Org-only access
  generateOrgReport
);

export default router;
