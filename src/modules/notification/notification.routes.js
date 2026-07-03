import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";

import {
  createNotificationController,
  getNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
} from "./notification.controller.js";

const router = express.Router();

// CREATE
router.post("/", authMiddleware, createNotificationController);

// GET ALL
router.get("/", authMiddleware, getNotificationsController);

// MARK ALL AS READ
router.patch("/mark-all-read", authMiddleware, markAllNotificationsReadController);

// MARK AS READ
router.patch("/:id/read", authMiddleware, markNotificationReadController);

export default router;
