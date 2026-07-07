import express from "express";
import {
  createIQRoomController,
  joinIQRoomController,
  getIQRoomController,
  startIQRoomController,
  getIQRoomLeaderboardController,
  getUserIQRoomHistoryController,
} from "./iqRoom.controller.js";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

router.post("/create", createIQRoomController);
router.post("/join", joinIQRoomController);
router.get("/history", getUserIQRoomHistoryController);
router.get("/:roomCode", getIQRoomController);
router.post("/:roomCode/start", startIQRoomController);
router.get("/:roomCode/leaderboard", getIQRoomLeaderboardController);

export default router;
