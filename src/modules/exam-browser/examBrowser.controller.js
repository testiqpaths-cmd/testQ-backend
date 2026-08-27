import * as examBrowserService from "./examBrowser.service.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

// Same inline header-parsing style as auth.middleware.js (no shared helper
// exists there either) — the Electron app's bearer credential is the raw
// sessionId, not a JWT, so this deliberately does not call authMiddleware.
function extractBearerSessionId(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing exam session credential");
  }
  return header.slice(7).trim();
}

// The raw sessionId is returned exactly once — from createSessionController
// below, right after generation. Every other response uses this shape,
// which never echoes it back, to shrink how many log lines/response bodies
// carry the live credential.
function toResponseShape(session) {
  return {
    id: session._id,
    status: session.status,
    studentId: session.studentId,
    examId: session.examId,
    attemptId: session.attemptId,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    submittedAt: session.submittedAt,
  };
}

export const createSessionController = async (req, res, next) => {
  try {
    const { examId, attemptId } = req.body || {};
    const session = await examBrowserService.createSession(req.user._id, { examId, attemptId });
    res.status(201).json({
      success: true,
      message: "Exam session created",
      data: { sessionId: session.sessionId, ...toResponseShape(session) },
    });
  } catch (error) {
    next(error);
  }
};

export const claimSessionController = async (req, res, next) => {
  try {
    const sessionId = extractBearerSessionId(req);
    const { browserClientId } = req.body || {};
    const session = await examBrowserService.claimSession({ sessionId, browserClientId });
    // launchToken is deliberately excluded from toResponseShape() (shared by
    // 5 other endpoints) — only the claim response ever carries it, matching
    // the same "never echo more than needed" treatment sessionId itself gets.
    res.json({
      success: true,
      message: "Exam session claimed",
      data: { ...toResponseShape(session), launchToken: session.launchToken },
    });
  } catch (error) {
    next(error);
  }
};

export const heartbeatController = async (req, res, next) => {
  try {
    const sessionId = extractBearerSessionId(req);
    const session = await examBrowserService.recordHeartbeat(sessionId);
    res.json({ success: true, message: "Heartbeat recorded", data: toResponseShape(session) });
  } catch (error) {
    next(error);
  }
};

export const securityEventController = async (req, res, next) => {
  try {
    const sessionId = extractBearerSessionId(req);
    const { type, timestamp, meta } = req.body || {};
    await examBrowserService.recordSecurityEvent(sessionId, { type, timestamp, meta });
    res.status(201).json({ success: true, message: "Security event recorded", data: null });
  } catch (error) {
    next(error);
  }
};

export const submitSessionController = async (req, res, next) => {
  try {
    const sessionId = extractBearerSessionId(req);
    const session = await examBrowserService.submitSession(sessionId);
    res.json({ success: true, message: "Exam session submitted", data: toResponseShape(session) });
  } catch (error) {
    next(error);
  }
};

export const getMySessionController = async (req, res, next) => {
  try {
    const sessionId = extractBearerSessionId(req);
    const session = await examBrowserService.getSessionForBearer(sessionId);
    res.json({ success: true, message: "Exam session status", data: toResponseShape(session) });
  } catch (error) {
    next(error);
  }
};

export const getSessionByIdController = async (req, res, next) => {
  try {
    const session = await examBrowserService.getSessionById(req.params.id, req.user);
    res.json({ success: true, message: "Exam session status", data: toResponseShape(session) });
  } catch (error) {
    next(error);
  }
};

export const terminateSessionController = async (req, res, next) => {
  try {
    const session = await examBrowserService.terminateSession(req.params.id, req.user, req.body?.reason);
    res.json({ success: true, message: "Exam session terminated", data: toResponseShape(session) });
  } catch (error) {
    next(error);
  }
};
