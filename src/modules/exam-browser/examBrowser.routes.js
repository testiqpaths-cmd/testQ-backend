import express from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";
import {
  createSessionController,
  claimSessionController,
  heartbeatController,
  securityEventController,
  submitSessionController,
  getMySessionController,
  getSessionByIdController,
  terminateSessionController,
} from "./examBrowser.controller.js";

const router = express.Router();

// Portal-side: a logged-in student starts a secure exam.
router.post("/session", authMiddleware, roleMiddleware("STUDENT"), createSessionController);

// Electron-side, sessionId-authenticated (Authorization: Bearer <sessionId>).
// No authMiddleware in this chain — the Electron app has no user JWT of its
// own; the sessionId itself IS the credential, validated inside the
// service/controller. Mirrors subscription.routes.js's Razorpay webhook,
// the only existing precedent in this backend for non-JWT route auth.
router.post("/session/claim", claimSessionController);
router.post("/heartbeat", heartbeatController);
router.post("/security-event", securityEventController);
router.post("/session/submit", submitSessionController);

// Static path — MUST be registered before the /:id param route below, or
// Express would match "me" as :id.
router.get("/session/me", getMySessionController);

// Portal/admin-side, JWT-authenticated lookup by Mongo _id (never the
// bearer sessionId — see examBrowser.controller.js's response-shaping note
// on why the raw sessionId is never echoed back after creation).
router.get("/session/:id", authMiddleware, getSessionByIdController);
router.post("/session/:id/terminate", authMiddleware, terminateSessionController);

export default router;
