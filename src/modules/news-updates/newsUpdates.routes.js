import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { createNewsController, deleteNewsController, getNewsUpdatesController } from "./newsUpdates.controller.js";

const router = express.Router();

router.post("/", authMiddleware, createNewsController);
router.get("/", authMiddleware, getNewsUpdatesController);
router.delete("/:id", authMiddleware, deleteNewsController);

export default router;
