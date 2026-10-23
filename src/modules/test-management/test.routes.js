import { Router } from "express";
import {
  authMiddleware,
  
} from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import loadTest from "./middlewares/loadTest.middleware.js";
import schedule from "./middlewares/schedule.middleware.js";
import visibility from "./middlewares/visibility.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";
import { companyWiseFeatureMiddleware } from "../../common/middlewares/companyWiseFeature.middleware.js";

import {
  createTest,
  getTest,
  updateTest,
  deleteTest,
  getAllTests,
  getMyTests,
  getAssignedTests,
  getTestStats,
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
  // Company-wise access is checked before CREATE_TEST usage is consumed, so
  // a FREE student's rejected company-wise request never burns a CREATE_TEST
  // usage credit.
  companyWiseFeatureMiddleware(),
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

// Per-test registration/completion/result stats — creator (or admin) only.
router.get(
  "/tests/:id/stats",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION"),
  loadTest,
  getTestStats
);

//get one
router.get("/tests/:id", authMiddleware, loadTest, visibility, schedule, getTest);

router.put(
  "/tests/:id",
  authMiddleware,
  roleMiddleware("IQPATH_ADMIN", "ORGANIZATION", "STUDENT"),
  loadTest,
  // Merge-aware: gates this update whenever the resulting test would still
  // have companyIds set, even if this particular request doesn't mention
  // companyIds itself (see companyWiseFeature.middleware.js).
  companyWiseFeatureMiddleware({ mergeWithExisting: true }),
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
