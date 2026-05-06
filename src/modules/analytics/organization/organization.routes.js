import express from "express";
import {
  getOrganizationAnalytics,
  createOrganization,
} from "./organization.controller.js";

import {
  authMiddleware,
} from "../../../common/middlewares/auth.middleware.js";

import {
  roleMiddleware
} from "../../../common/middlewares/role.middleware.js";

const router = express.Router();

/* Create Organization */
router.post(
  "/",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  createOrganization
);

/* Organization Analytics */
router.get(
  "/organization/:orgId",
  authMiddleware,
  roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),
  getOrganizationAnalytics
);

export default router;