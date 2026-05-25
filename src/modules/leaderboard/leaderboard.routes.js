import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";

import {
  getTestLeaderboard,
  getSeriesLeaderboard,
} from "./leaderboard.controller.js";

const router = express.Router();


// 🧪 TEST leaderboard
router.get(
  "/test/:testId",
  authMiddleware,
  getTestLeaderboard
);


// 📚 SERIES leaderboard
router.get(
  "/series/:seriesId",
  authMiddleware,
  getSeriesLeaderboard
);


export default router;