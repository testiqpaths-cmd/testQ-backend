import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { createNewsController, getNewsUpdatesController } from "./newsUpdates.controller.js";

const router = express.Router();

router.post("/", authMiddleware, createNewsController);
router.get("/", authMiddleware, getNewsUpdatesController);

export default router;
