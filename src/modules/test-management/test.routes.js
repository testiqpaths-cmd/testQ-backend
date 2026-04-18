import { Router } from "express";
import {
  authMiddleware,
  
} from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import loadTest from "./middlewares/loadTest.middleware.js";
import schedule from "./middlewares/schedule.middleware.js";
import visibility from "./middlewares/visibility.middleware.js";

import {
  createTest,
  getTest,
  updateTest,
  deleteTest,
  getAllTests,
  getMyTests,
} from "./test.controller.js";


const router = Router();

router.post(
  "/tests",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION","STUDENT"),
  createTest
);
router.get(
  "/tests/my",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  getMyTests
);

//get one
router.get("/tests/:id", authMiddleware, loadTest, visibility, schedule, getTest);

router.put(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  loadTest,
  updateTest
);

router.delete(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
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
