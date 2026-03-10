import express from "express";
import { getPlatformAnalytics } from "./admin.controller.js";
import { authMiddleware, roleMiddleware } from "../../../common/middlewares/auth.middleware.js";
import { ROLES } from "../constants/roles.constants.js";

const router = express.Router();

router.get(
  "/platform",
  authMiddleware,
  roleMiddleware(ROLES.IQPATH_ADMIN),
  getPlatformAnalytics
);

export default router;
