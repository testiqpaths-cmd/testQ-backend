import mongoose from "mongoose";

// One entry per reported/inferred security signal for a session. CLIENT
// entries arrive via POST /security-event from the Electron app; SERVER
// entries are synthesized by syncSessionStatus() in examBrowser.service.js
// (e.g. a heartbeat timeout discovered on the next read) — never POSTed.
const securityEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "WINDOW_BLUR",
        "WINDOW_FOCUS",
        "FULLSCREEN_EXITED",
        "WINDOW_MINIMIZED",
        "UNEXPECTED_NAVIGATION_BLOCKED",
        "EXTERNAL_URL_BLOCKED",
        "NEW_WINDOW_BLOCKED",
        "HEARTBEAT_TIMEOUT",
        "SESSION_EXPIRED",
        "PROHIBITED_PROCESS_DETECTED",
      ],
    },
    timestamp: { type: Date, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    source: { type: String, enum: ["CLIENT", "SERVER"], default: "CLIENT" },
  },
  { _id: false }
);

// sessionId is a 64-hex-char bearer credential (crypto.randomBytes(32)),
// deliberately NOT the Mongo _id — an ObjectId is guessable/sequential-ish
// and must never double as an auth secret. _id remains the real primary
// key for JWT-authenticated portal/admin lookups (GET /session/:id).
const examSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Optional and loosely referenced: no "requires secure browser" flag
    // exists on Test yet, and this module does not add one. When provided,
    // the service layer only checks the referenced docs exist/belong to
    // this student — it enforces no secure-exam policy of its own.
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
      default: null,
    },
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestAttempt",
      default: null,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "SUBMITTED", "EXPIRED", "TERMINATED"],
      default: "PENDING",
    },

    // Bound at claim time only; every call after that is authenticated by
    // the sessionId bearer credential alone (see examBrowser.service.js).
    browserClientId: {
      type: String,
      default: null,
    },

    // Minted fresh on every successful claim; redeemed exactly once via
    // POST /auth/exchange-launch-token to log the Electron window's fresh
    // browser profile in as the student, then cleared. No unique index —
    // a crypto-random 32-byte token needs none, and one would reopen the
    // unique+sparse+default:null footgun documented on Payment.model.js
    // (many docs would carry an explicit `launchToken: null` once redeemed).
    launchToken: { type: String, default: null, index: true },
    launchTokenExpiresAt: { type: Date, default: null },

    startedAt: { type: Date, default: null }, // set when claimed (PENDING -> ACTIVE)
    // Doubles as the PENDING "must be claimed by" deadline and, once
    // claimed, the ACTIVE session's absolute ceiling — the two statuses
    // are mutually exclusive so one field serves both without ambiguity.
    expiresAt: { type: Date, required: true, index: true },
    lastHeartbeatAt: { type: Date, default: null },

    submittedAt: { type: Date, default: null },
    terminatedAt: { type: Date, default: null },
    terminationReason: { type: String, default: null },

    securityEvents: { type: [securityEventSchema], default: [] },
  },
  { timestamps: true }
);

// Supports a future ops/cleanup job scanning for stale PENDING/ACTIVE rows.
// No such job exists yet — this is cheap insurance for later, not used now.
examSessionSchema.index({ status: 1, expiresAt: 1 });

// Note: sessionId is the only unique field and is `required: true` (never
// null), so this model never hits the `unique + sparse + default: null`
// footgun documented in Payment.model.js — sparse is not needed here.

export default mongoose.model("ExamSession", examSessionSchema);
