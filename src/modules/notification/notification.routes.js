import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";

import {
  createNotificationController,
  getNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
  deleteNotificationController,
  deleteAllNotificationsController,
} from "./notification.controller.js";

const router = express.Router();

// CREATE
router.post("/", authMiddleware, createNotificationController);

// GET ALL
router.get("/", authMiddleware, getNotificationsController);

// DELETE ALL
router.delete("/all", authMiddleware, deleteAllNotificationsController);

// MARK ALL AS READ
router.patch("/mark-all-read", authMiddleware, markAllNotificationsReadController);

// MARK AS READ
router.patch("/:id/read", authMiddleware, markNotificationReadController);

// DELETE ONE
router.delete("/:id", authMiddleware, deleteNotificationController);

export default router;
