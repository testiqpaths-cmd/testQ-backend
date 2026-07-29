import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import {
  createContactUsController,
  getContactUsController,
  deleteContactUsController,
} from "./contactUs.controller.js";

const router = Router();

// Public create endpoint
router.post("/", createContactUsController);

// List - requires auth and filters by role
router.get("/", authMiddleware, getContactUsController);

// Delete - only ORGANIZATION or ADMIN can delete
router.delete("/:id", authMiddleware, roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"), deleteContactUsController);

export default router;
