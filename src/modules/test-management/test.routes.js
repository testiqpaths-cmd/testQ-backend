import { Router } from "express";
import { authMiddleware, roleMiddleware } from "../../common/middlewares/auth.middleware.js";
import loadTest from "./middlewares/loadTest.middleware.js";
import schedule from "./middlewares/schedule.middleware.js";
import visibility from "./middlewares/visibility.middleware.js";

import { createTestSchema } from "./schemas/test.schema.js";
import { createTest, getTest, updateTest, deleteTest } from "./test.controller.js";

const router = Router();
// router.post(
//   "/tests",
//   authMiddleware,
//   roleMiddleware("ADMIN", "ORG"),
//   (req, res, next) => {
//     createTestSchema.parse(req.body);
//     next();
//   },
//   createTest
// );
router.post(
  "/tests",
  authMiddleware,
  roleMiddleware("ADMIN", "ORG"),
  (req, res, next) => {
    try {
      createTestSchema.parse(req.body);
      next();
    } catch (err) {
      return res.status(400).json({
        success: false,
        errors: err.errors,
      });
    }
  },
  createTest
);


router.get(
  "/tests/:id",
  authMiddleware,
  loadTest,
  visibility,
  schedule,
  getTest
);

router.put(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("ADMIN", "ORG"),
  loadTest,
  updateTest
);

router.delete(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  loadTest,
  deleteTest
);


export default router;
