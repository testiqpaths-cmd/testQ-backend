import express from "express";
import { getTestStatsController } from "./testStats.controller.js";
import {
  authMiddleware,
  roleMiddleware,
} from "../../../common/middlewares/auth.middleware.js";

const router = express.Router();

router.get(
  "/analytics/tests/:testId",
  authMiddleware,
  roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"), // ✅ only org + admin allowed
  getTestStatsController
);

export default router;
