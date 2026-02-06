import { Router } from "express";
import {
  authMiddleware,
  roleMiddleware,
} from "../../common/middlewares/auth.middleware.js";
import loadTest from "./middlewares/loadTest.middleware.js";
import schedule from "./middlewares/schedule.middleware.js";
import visibility from "./middlewares/visibility.middleware.js";

import { createTestSchema } from "./schemas/test.schema.js";
import { createTest, getTest, updateTest, deleteTest ,getAllTests } from "./test.controller.js";
import { ZodError } from "zod";


const router = Router();

router.post(
  "/tests",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION","STUDENT"),
  (req, res, next) => {
    try {
      const parsed = createTestSchema.parse(req.body);
      req.body = parsed; // ✅ ensure parsed/coerced values are used
      next();
    } catch (err) {
      console.log("❌ Create Test Validation Error:", err.errors);
      console.log("❌ Body Received:", req.body);

      
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: err.errors,
      });
    }
  },
  createTest
);
//get one
router.get("/tests/:id", authMiddleware, loadTest, visibility, schedule, getTest);

router.put(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"),
  loadTest,
  updateTest
);

router.delete(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN"),
  loadTest,
  deleteTest
);

// ✅ Get ALL Tests
router.get(
  "/",
  authMiddleware,
  // roleMiddleware("IQPATH_ADMIN", "ORG"), // optional
  getAllTests
);


export default router;
