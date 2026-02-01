import { Router } from "express";
import { authMiddleware, roleMiddleware } from "../../common/middlewares/auth.middleware.js";
import loadSeries from "./middlewares/loadSeries.middleware.js";
import { createTestSeriesSchema } from "./schemas/testSeries.schema.js";
import { createSeries, getSeries, updateSeries, deleteSeries } from "./testSeries.controller.js";

const router = Router();

router.post(
  "/test-series",
  authMiddleware,
  roleMiddleware("ADMIN", "ORG"),
  (req, res, next) => {
    try {
      createTestSeriesSchema.parse(req.body);
      next();
    } catch (err) {
      return res.status(400).json({
        success: false,
        errors: err.errors,
      });
    }
  },
  createSeries
);

router.get(
  "/test-series/:id",
  authMiddleware,
  loadSeries,
  getSeries
);

router.put(
  "/test-series/:id",
  authMiddleware,
  roleMiddleware("ADMIN", "ORG"),
  loadSeries,
  updateSeries
);

router.delete(
  "/test-series/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  loadSeries,
  deleteSeries
);

// ✅ Default export fixes the import
export default router;
