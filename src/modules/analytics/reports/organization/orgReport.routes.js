import express from "express";
import { generateOrgReport } from "./orgReport.controller.js";
import { authMiddleware} from "../../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../../../common/middlewares/feature.middleware.js";

const router = express.Router();

// GET /reports/organization/:orgId?format=pdf|excel
router.get(
  "/organization/:orgId",
  authMiddleware,
  roleMiddleware("ORGANIZATION"), // Org-only access
  featureMiddleware("ANALYTICS"),
  generateOrgReport
);

export default router;
