import express from "express";
import { getOrganizationAnalytics } from "./organization.controller.js";
import {
  authMiddleware,
  roleMiddleware,
} from "../../../common/middlewares/auth.middleware.js";

const router = express.Router();

router.get(
  "/organization/:orgId",
  authMiddleware,                 
  roleMiddleware("ORGANIZATION", "IQPATH_ADMIN"),      
  getOrganizationAnalytics        
);

export default router;
