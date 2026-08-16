import express from "express";
import {
  createIQRoomController,
  joinIQRoomController,
  getIQRoomController,
  startIQRoomController,
  getIQRoomLeaderboardController,
  getUserIQRoomHistoryController,
  getMyIQRoomResultController,
} from "./iqRoom.controller.js";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

router.post("/create", featureMiddleware("IQ_ROOM", true), createIQRoomController);
router.post("/join", featureMiddleware("IQ_ROOM"), joinIQRoomController);
router.get("/history", getUserIQRoomHistoryController);
router.get("/:roomCode", getIQRoomController);
router.post("/:roomCode/start", startIQRoomController);
router.get("/:roomCode/leaderboard", getIQRoomLeaderboardController);
router.get("/:roomCode/my-result", getMyIQRoomResultController);

export default router;
