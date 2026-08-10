import { Router } from "express";
import { authMiddleware} from "../../common/middlewares/auth.middleware.js";
import loadSeries from "./middlewares/loadSeries.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";
import mongoose from "mongoose";
import {
  createSeries,
  getSeries,
  getSeriesList,
  updateSeries,
  deleteSeries,
  acceptSeriesAssignment,
  declineSeriesAssignment,
  pendingSeriesAssignment,
  hideSeriesAssignment,
  getSeriesStats,
} from "./testSeries.controller.js";
import { createSeriesTest } from "./testSeries.controller.js";

const router = Router();

// ✅ CREATE: POST /api/test-series
router.post(
  "/",
  authMiddleware,                 // enable later if needed
  roleMiddleware("IQPATH_ADMIN","ORGANIZATION","STUDENT"),  // enable later if needed
  createSeries
);

// ✅ LIST: GET /api/test-series
router.get(
  "/",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  featureMiddleware("TEST_SERIES"),
  getSeriesList
);

// ✅ GET ONE: GET /api/test-series/:id
router.get(
  "/:id",
  authMiddleware,
  loadSeries,
  getSeries
);

// ✅ UPDATE: PUT /api/test-series/:id
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"),
  loadSeries,
  updateSeries
);

// ✅ DELETE: DELETE /api/test-series/:id
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  loadSeries,
  deleteSeries
);

// ✅ CREATE TEST INSIDE SERIES: POST /api/test-series/:id/tests
router.post(
  "/:id/tests",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN","ORGANIZATION"),
  loadSeries,
  createSeriesTest
);

// Registration/completion/results stats — creator (or admin) only.
router.get(
  "/:id/stats",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"),
  loadSeries,
  getSeriesStats
);

// Student series-assignment actions — mirrors the per-test accept/decline/
// pending/hide endpoints in test.routes.js, but at the series level.
router.post("/:id/accept", authMiddleware, roleMiddleware("STUDENT"), loadSeries, acceptSeriesAssignment);
router.post("/:id/decline", authMiddleware, roleMiddleware("STUDENT"), loadSeries, declineSeriesAssignment);
router.post("/:id/pending", authMiddleware, roleMiddleware("STUDENT"), loadSeries, pendingSeriesAssignment);
router.post("/:id/hide", authMiddleware, roleMiddleware("STUDENT"), loadSeries, hideSeriesAssignment);

export default router;
