import express from "express";
import {
  getOrganizations,
  getOrganizationAnalytics,
  createOrganization
} from "./organization.controller.js";

import {
  authMiddleware,
} from "../../../common/middlewares/auth.middleware.js";

import {
  roleMiddleware
} from "../../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../../common/middlewares/feature.middleware.js";

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),
  getOrganizations
);

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
  featureMiddleware("ANALYTICS"),
  getOrganizationAnalytics
);

export default router;
  