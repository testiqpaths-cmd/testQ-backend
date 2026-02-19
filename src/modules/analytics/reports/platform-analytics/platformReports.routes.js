import express from "express";
import { generatePlatformReport } from "./platformReports.controller.js";
import { authMiddleware, roleMiddleware } from "../../../../common/middlewares/auth.middleware.js";

const router = express.Router();

// GET /reports/platform?format=pdf
router.get(
  "/platform",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"), // ✅ Admin-only access
  generatePlatformReport
);

export default router;
