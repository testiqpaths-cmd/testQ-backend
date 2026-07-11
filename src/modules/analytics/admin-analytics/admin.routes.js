import express from "express";
import { getPlatformAnalytics } from "./admin.controller.js";
import { authMiddleware} from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../../common/middlewares/feature.middleware.js";
import { ROLES } from "../constants/roles.constants.js";

const router = express.Router();

router.get(
  "/platform",
  authMiddleware,
  roleMiddleware(ROLES.IQPATH_ADMIN),
  featureMiddleware("ANALYTICS"),
  getPlatformAnalytics
);

export default router;
