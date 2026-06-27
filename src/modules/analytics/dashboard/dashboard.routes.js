import express from "express";
import { getStudentDashboardController } from "./dashboard.controller.js";
import { authMiddleware } from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";

const router = express.Router();

router.get(
  "/student",
  authMiddleware,
  roleMiddleware("STUDENT", "IQPATH_ADMIN", "ORGANIZATION"),
  getStudentDashboardController
);

export default router;
