import express from "express";
import { generateStudentReport } from "./studentReport.controller.js";
import {
  authMiddleware,
  
} from "../../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../../../common/middlewares/feature.middleware.js";

const router = express.Router();

router.get(
  "/student/results",
  authMiddleware,
 roleMiddleware("STUDENT", "ORGANIZATION", "IQPATH_ADMIN"),
  featureMiddleware("ANALYTICS"),
  generateStudentReport
);

export default router;
