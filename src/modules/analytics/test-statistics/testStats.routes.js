import express from "express";
import { getTestStatsController } from "./testStats.controller.js";
import {
  authMiddleware,
  
} from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";
const router = express.Router();

router.get(
  "/analytics/tests/:testId",
  authMiddleware,
  roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"), // ✅ only org + admin allowed
  getTestStatsController
);

export default router;
