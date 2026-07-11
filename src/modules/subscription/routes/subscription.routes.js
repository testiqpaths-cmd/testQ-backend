import express from "express";
import { authMiddleware } from "../../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../../common/middlewares/role.middleware.js";
import {
  getMySubscriptionDetails,
  upgradeMyPlan,
  getAvailablePlansForMyRole,
  getAllPlansPublic,
  assignUserPlanController,
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getFeatures,
  createFeature,
  updateFeature,
  deleteFeature,
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getPlanFeatures,
  updatePlanFeature
} from "../controllers/subscription.controller.js";

const router = express.Router();

// User Routes
router.get("/me", authMiddleware, getMySubscriptionDetails);
router.post("/upgrade", authMiddleware, upgradeMyPlan);
router.get("/my-available-plans", authMiddleware, getAvailablePlansForMyRole);
router.get("/plans", authMiddleware, getAllPlansPublic);

// Admin / Organization Routes
router.patch("/users/:userId/plan", authMiddleware, roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"), assignUserPlanController);

// Admin Routes
const adminOnly = [authMiddleware, roleMiddleware("IQPATH_ADMIN")];

router.get("/admin/roles", adminOnly, getRoles);
router.post("/admin/roles", adminOnly, createRole);
router.put("/admin/roles/:id", adminOnly, updateRole);
router.delete("/admin/roles/:id", adminOnly, deleteRole);

router.get("/admin/features", adminOnly, getFeatures);
router.post("/admin/features", adminOnly, createFeature);
router.put("/admin/features/:id", adminOnly, updateFeature);
router.delete("/admin/features/:id", adminOnly, deleteFeature);

router.get("/admin/plans", adminOnly, getPlans);
router.post("/admin/plans", adminOnly, createPlan);
router.put("/admin/plans/:id", adminOnly, updatePlan);
router.delete("/admin/plans/:id", adminOnly, deletePlan);

router.get("/admin/plans/:planId/features", adminOnly, getPlanFeatures);
router.put("/admin/plans/:planId/features/:featureId", adminOnly, updatePlanFeature);

export default router;
