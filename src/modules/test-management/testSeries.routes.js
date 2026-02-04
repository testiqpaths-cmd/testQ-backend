import { Router } from "express";
import { authMiddleware, roleMiddleware } from "../../common/middlewares/auth.middleware.js";
import loadSeries from "./middlewares/loadSeries.middleware.js";
import { createTestSeriesSchema } from "./schemas/testSeries.schema.js";
import { createSeries, getSeries, updateSeries, deleteSeries } from "./testSeries.controller.js";

const router = Router();

router.post(
  "/test-series",
 createSeries
);
// router.post(
//   "/",
//   createSeries
// );


// router.post(
//   "/test-series",
//   authMiddleware,
//   roleMiddleware("IQPATH_ADMIN"),
//   createSeries
// );


router.get(
  "/test-series/:id",
  authMiddleware,
  loadSeries,
  getSeries
);

router.put(
  "/test-series/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORG"),
  loadSeries,
  updateSeries
);

router.delete(
  "/test-series/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  loadSeries,
  deleteSeries
);

// ✅ Default export fixes the import
export default router;
