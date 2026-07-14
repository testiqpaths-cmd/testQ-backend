import express from "express";
import { 
  getStudentDashboardController, 
  getAdminDashboardController, 
  getOrganizationDashboardController 
} from "./dashboard.controller.js";
import { authMiddleware } from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../../common/middlewares/feature.middleware.js";

const router = express.Router();

router.get(
  "/student",
  authMiddleware,
  roleMiddleware("STUDENT", "IQPATH_ADMIN", "ORGANIZATION"),
  featureMiddleware("DASHBOARD"),
  getStudentDashboardController
);

router.get(
  "/admin",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  featureMiddleware("DASHBOARD"),
  getAdminDashboardController
);

router.get(
  "/organization",
  authMiddleware,
  roleMiddleware("ORGANIZATION"),
  featureMiddleware("DASHBOARD"),
  getOrganizationDashboardController
);

export default router;
