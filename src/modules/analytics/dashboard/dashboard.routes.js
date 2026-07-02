import express from "express";
import { 
  getStudentDashboardController, 
  getAdminDashboardController, 
  getOrganizationDashboardController 
} from "./dashboard.controller.js";
import { authMiddleware } from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";

const router = express.Router();

router.get(
  "/student",
  authMiddleware,
  roleMiddleware("STUDENT", "IQPATH_ADMIN", "ORGANIZATION"),
  getStudentDashboardController
);

router.get(
  "/admin",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  getAdminDashboardController
);

router.get(
  "/organization",
  authMiddleware,
  roleMiddleware("ORGANIZATION"),
  getOrganizationDashboardController
);

export default router;
