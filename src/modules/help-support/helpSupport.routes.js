import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import {
  createHelpSupportController,
  getHelpSupportsController,
  resolveHelpSupportController,
} from "./helpSupport.controller.js";

const router = Router();

// Create query (anyone logged in)
router.post("/", authMiddleware, createHelpSupportController);

// Get queries (filtered by role internally)
router.get("/", authMiddleware, getHelpSupportsController);

// Resolve query (only ORG or ADMIN)
router.patch("/:id/resolve", authMiddleware, roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"), resolveHelpSupportController);

export default router;
