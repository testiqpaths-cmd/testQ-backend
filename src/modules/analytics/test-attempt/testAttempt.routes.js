import express from "express";
import { getMyResultsController } from "./testAttempt.controller.js";
import { getDetailedAnalysisController } from "../../test-attempts/testAttempt.controller.js";
import {
  authMiddleware,
  
} from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../../common/middlewares/feature.middleware.js";
const router = express.Router();

router.get(
  "/students/me/results",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  featureMiddleware("ANALYTICS"),
  getMyResultsController
);

router.get(
  "/:attemptId/detailed-analysis",
  authMiddleware,
  featureMiddleware("ANALYTICS"),
  getDetailedAnalysisController
);

export default router;
