import crypto from "crypto";
import ExamSession from "./examBrowser.model.js";
import Test from "../../models/test.model.js";
import TestAttempt from "../../models/testAttempt.model.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import env from "../../config/env.js";

const CLIENT_EVENT_TYPES = [
  "WINDOW_BLUR",
  "WINDOW_FOCUS",
  "FULLSCREEN_EXITED",
  "WINDOW_MINIMIZED",
  "UNEXPECTED_NAVIGATION_BLOCKED",
  "EXTERNAL_URL_BLOCKED",
  "NEW_WINDOW_BLOCKED",
  "PROHIBITED_PROCESS_DETECTED",
];

// Same constant-time-with-length-guard style as subscription.service.js's
// Razorpay signature checks — used here for comparing browserClientId on a
// re-claim, since that comparison decides whether a retry is trusted or a
// hijack attempt is rejected.
const safeCompare = (a, b) => {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Recomputes status in place against the current time — mirrors this
 * backend's existing computeTestStatus "derive fresh, don't trust the
 * stored value" pattern rather than a Mongo TTL index, since this document
 * must survive as an evidence/telemetry trail (design doc §17), not be
 * deleted on expiry. Pure mutation, does not save — always call through
 * syncAndPersist below rather than this directly, so a change never gets
 * discarded by a caller that branches/throws before its own save.
 */
function syncSessionStatus(session) {
  const now = new Date();

  if (session.status === "PENDING" && session.expiresAt <= now) {
    session.status = "EXPIRED";
    return session;
  }

  if (session.status === "ACTIVE") {
    const heartbeatTimeoutMs = env.EXAM_SESSION_HEARTBEAT_TIMEOUT_SECONDS * 1000;
    const heartbeatStale =
      session.lastHeartbeatAt && now - session.lastHeartbeatAt > heartbeatTimeoutMs;

    if (session.expiresAt <= now) {
      session.status = "EXPIRED";
      session.securityEvents.push({ type: "SESSION_EXPIRED", timestamp: now, source: "SERVER" });
    } else if (heartbeatStale) {
      session.status = "EXPIRED";
      session.securityEvents.push({ type: "HEARTBEAT_TIMEOUT", timestamp: now, source: "SERVER" });
    }
  }

  return session;
}

async function findByBearerSessionId(sessionId) {
  if (!sessionId) throw new ApiError(401, "Missing exam session credential");
  const session = await ExamSession.findOne({ sessionId });
  if (!session) throw new ApiError(404, "Exam session not found");
  return session;
}

/**
 * Runs syncSessionStatus and, if it actually changed anything, persists
 * immediately — before the caller does any further branching. Without this,
 * a caller that syncs and then throws on the newly-EXPIRED status (e.g.
 * claimSession/recordHeartbeat rejecting a stale session) would compute the
 * transition in memory and then discard it, silently losing both the status
 * flip and its SESSION_EXPIRED/HEARTBEAT_TIMEOUT audit event — exactly the
 * evidence trail this model exists to keep (design doc §17).
 */
async function syncAndPersist(session) {
  syncSessionStatus(session);
  if (session.isModified()) await session.save();
  return session;
}

function isOwnerOrPrivileged(session, requestingUser) {
  const isOwner = String(session.studentId) === String(requestingUser._id);
  const isPrivileged = ["ORGANIZATION", "IQPATH_ADMIN"].includes(requestingUser.role);
  return isOwner || isPrivileged;
}

/**
 * Portal-side: a logged-in student starts a secure exam. examId/attemptId
 * are optional (no "requires secure browser" flag exists on Test yet) but
 * are existence/ownership-checked when provided.
 */
export const createSession = async (studentId, { examId, attemptId } = {}) => {
  if (examId && !(await Test.exists({ _id: examId }))) {
    throw new ApiError(404, "examId does not reference an existing test");
  }
  if (attemptId) {
    const attempt = await TestAttempt.findById(attemptId);
    if (!attempt) throw new ApiError(404, "attemptId does not reference an existing attempt");
    if (String(attempt.studentId) !== String(studentId)) {
      throw new ApiError(403, "This attempt does not belong to the requesting student");
    }
    if (examId && String(attempt.testId) !== String(examId)) {
      throw new ApiError(400, "attemptId does not belong to examId");
    }
  }

  const sessionId = crypto.randomBytes(32).toString("hex");
  return ExamSession.create({
    sessionId,
    studentId,
    examId: examId || null,
    attemptId: attemptId || null,
    status: "PENDING",
    expiresAt: new Date(Date.now() + env.EXAM_SESSION_PENDING_TTL_SECONDS * 1000),
  });
};

/**
 * Electron-side, sessionId-authenticated. Idempotent for retries from the
 * SAME browserClientId (network flakiness must not strand a legitimate
 * client); a different browserClientId or a non-PENDING status is a hard
 * 409 — this is the hijack-prevention the design doc (§13) requires.
 */
export const claimSession = async ({ sessionId, browserClientId }) => {
  if (!browserClientId) throw new ApiError(400, "browserClientId is required");

  const session = await findByBearerSessionId(sessionId);
  await syncAndPersist(session);

  const isIdempotentRetry =
    session.status === "ACTIVE" && safeCompare(session.browserClientId, browserClientId);

  if (!isIdempotentRetry) {
    if (session.status !== "PENDING") {
      throw new ApiError(409, `Exam session cannot be claimed (status: ${session.status})`);
    }
    session.browserClientId = browserClientId;
    session.status = "ACTIVE";
    session.startedAt = new Date();
    session.expiresAt = new Date(Date.now() + env.EXAM_SESSION_ACTIVE_TTL_SECONDS * 1000);
    session.lastHeartbeatAt = new Date();
  }

  // A fresh launch token on every successful claim call, including
  // idempotent retries — a retry exists specifically because the original
  // response may never have reached the client, so it must carry a
  // currently-usable token of its own, not rely on one from an attempt it
  // never saw the response to.
  session.launchToken = crypto.randomBytes(32).toString("hex");
  session.launchTokenExpiresAt = new Date(Date.now() + env.EXAM_LAUNCH_TOKEN_TTL_SECONDS * 1000);

  await session.save();
  return session;
};

export const recordHeartbeat = async (sessionId) => {
  const session = await findByBearerSessionId(sessionId);
  await syncAndPersist(session);
  if (session.status !== "ACTIVE") {
    throw new ApiError(410, `Exam session is not active (status: ${session.status})`);
  }
  session.lastHeartbeatAt = new Date();
  await session.save();
  return session;
};

export const recordSecurityEvent = async (sessionId, { type, timestamp, meta } = {}) => {
  const session = await findByBearerSessionId(sessionId);
  await syncAndPersist(session);
  if (session.status !== "ACTIVE") {
    throw new ApiError(410, `Exam session is not active (status: ${session.status})`);
  }
  if (!CLIENT_EVENT_TYPES.includes(type)) {
    throw new ApiError(400, `Unknown security event type: ${type}`);
  }
  session.securityEvents.push({
    type,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
    meta: meta ?? null,
    source: "CLIENT",
  });
  await session.save();
  return session;
};

export const submitSession = async (sessionId) => {
  const session = await findByBearerSessionId(sessionId);
  await syncAndPersist(session);
  if (session.status !== "ACTIVE") {
    throw new ApiError(409, `Exam session cannot be submitted (status: ${session.status})`);
  }
  session.status = "SUBMITTED";
  session.submittedAt = new Date();
  await session.save();
  return session;
};

/** Electron-side status poll (GET /session/me), sessionId-authenticated. */
export const getSessionForBearer = async (sessionId) => {
  const session = await findByBearerSessionId(sessionId);
  return syncAndPersist(session);
};

/** Portal/admin-side lookup by Mongo _id, JWT-authenticated. */
export const getSessionById = async (mongoId, requestingUser) => {
  const session = await ExamSession.findById(mongoId);
  if (!session) throw new ApiError(404, "Exam session not found");
  if (!isOwnerOrPrivileged(session, requestingUser)) throw new ApiError(403, "Forbidden");
  return syncAndPersist(session);
};

export const terminateSession = async (mongoId, requestingUser, reason) => {
  const session = await ExamSession.findById(mongoId);
  if (!session) throw new ApiError(404, "Exam session not found");
  if (!isOwnerOrPrivileged(session, requestingUser)) throw new ApiError(403, "Forbidden");
  await syncAndPersist(session);
  if (!["PENDING", "ACTIVE"].includes(session.status)) {
    throw new ApiError(409, `Exam session cannot be terminated (status: ${session.status})`);
  }
  session.status = "TERMINATED";
  session.terminatedAt = new Date();
  session.terminationReason = reason || "cancelled";
  await session.save();
  return session;
};
