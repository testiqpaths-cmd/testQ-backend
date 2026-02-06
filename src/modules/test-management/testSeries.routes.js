import { Router } from "express";
import { authMiddleware, roleMiddleware } from "../../common/middlewares/auth.middleware.js";
import loadSeries from "./middlewares/loadSeries.middleware.js";
import mongoose from "mongoose";
import {
  createSeries,
  getSeries,
  updateSeries,
  deleteSeries,
} from "./testSeries.controller.js";

const router = Router();

// ✅ CREATE: POST /api/test-series
router.post(
  "/",
  authMiddleware,                 // enable later if needed
  roleMiddleware("IQPATH_ADMIN","ORGANIZATION","STUDENT"),  // enable later if needed
  createSeries
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

export default router;
