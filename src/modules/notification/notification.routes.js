import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";

import {
  createNotificationController,
  getNotificationsController,
  markNotificationReadController,
} from "./notification.controller.js";

const router = express.Router();

// CREATE
router.post("/", authMiddleware, createNotificationController);

// GET ALL
router.get("/", authMiddleware, getNotificationsController);

// MARK AS READ
router.patch("/:id/read", authMiddleware, markNotificationReadController);

export default router;