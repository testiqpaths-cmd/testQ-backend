import express from "express";
import { getTimeBasedAnalytics } from "./timeBased.controller.js";
import {
  authMiddleware,
  roleMiddleware,
} from "../../../common/middlewares/auth.middleware.js";

const router = express.Router();

// Flexible endpoint for Organization + IQPath Admin
router.get(
  "/analytics/trends",
  authMiddleware,
  //roleMiddleware(["ORGANIZATION", "IQPATH_ADMIN"]),
  getTimeBasedAnalytics
);


export default router;
