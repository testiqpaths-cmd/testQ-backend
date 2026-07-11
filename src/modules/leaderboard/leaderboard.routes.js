import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";

import {
  getTestLeaderboard,
  getSeriesLeaderboard,
} from "./leaderboard.controller.js";

const router = express.Router();


// 🧪 TEST leaderboard
router.get(
  "/test/:testId",
  authMiddleware,
  featureMiddleware("LEADERBOARD"),
  getTestLeaderboard
);


// 📚 SERIES leaderboard
router.get(
  "/series/:seriesId",
  authMiddleware,
  featureMiddleware("LEADERBOARD"),
  getSeriesLeaderboard
);


export default router;