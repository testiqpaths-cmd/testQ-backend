import { Router } from "express";
import {
  authMiddleware,
  
} from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import loadTest from "./middlewares/loadTest.middleware.js";
import schedule from "./middlewares/schedule.middleware.js";
import visibility from "./middlewares/visibility.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";

import {
  createTest,
  getTest,
  updateTest,
  deleteTest,
  getAllTests,
  getMyTests,
  getAssignedTests,
  publishTest,
  acceptTestAssignment,
  declineTestAssignment,
  pendingTestAssignment,
  hideTestAssignment,
  startTestAssignment,
} from "./test.controller.js";


const router = Router();

router.post(
  "/tests",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION","STUDENT"),
  featureMiddleware("CREATE_TEST", true),
  createTest
);
router.get(
  "/tests/my",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  getMyTests
);
// Assigned tests (published tests visible to students/orgs)
router.get(
  "/assigned",
  authMiddleware,
  getAssignedTests
);

// Publish endpoint
router.patch(
  "/tests/:id/publish",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  loadTest,
  publishTest
);

// Student assignment action endpoints
router.post(
  "/tests/:id/accept",
  authMiddleware,
  roleMiddleware("STUDENT"),
  acceptTestAssignment
);

router.post(
  "/tests/:id/decline",
  authMiddleware,
  roleMiddleware("STUDENT"),
  declineTestAssignment
);

router.post(
  "/tests/:id/pending",
  authMiddleware,
  roleMiddleware("STUDENT"),
  pendingTestAssignment
);

router.post(
  "/tests/:id/hide",
  authMiddleware,
  roleMiddleware("STUDENT"),
  hideTestAssignment
);

router.post(
  "/tests/:id/start",
  authMiddleware,
  roleMiddleware("STUDENT"),
  startTestAssignment
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
