import { InterviewSession } from "../schemas/interview-session.schema.js";
import {
  IntegritySignal,
  INTEGRITY_SIGNAL_TYPES,
} from "../schemas/integrity-signal.schema.js";
import { assertCanViewSession } from "../utils/authorize.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const MAX_BATCH = 50;
// Ignore repeats of the same signal type within this window — the client
// batches, and a flapping detector (face in/out of frame) shouldn't write
// hundreds of rows.
const DEDUP_WINDOW_MS = 4000;

const SIGNAL_LABELS = {
  tab_switch: "Switched away from the interview tab",
  no_face: "Face not visible on camera",
  multi_face: "More than one face on camera",
  long_silence: "Extended silence during a question",
  audio_anomaly: "Background audio anomaly",
  mobile_phone_detected: "Phone visible on camera",
};

export class IntegrityService {
  async loadSession(sessionId) {
    if (!sessionId) throw new ApiError(400, "Session ID is required.");
    const query = sessionId.toString().startsWith("int-")
      ? { interviewId: sessionId }
      : { _id: sessionId };
    const session = await InterviewSession.findOne(query);
    if (!session) throw new ApiError(404, `Interview session not found: ${sessionId}`);
    return session;
  }

  /**
   * Candidate-only: append a batch of observed proctoring signals for
   * their own in-progress interview. Non-owners are rejected — org/admin
   * observe, they don't emit. Returns { recorded, skipped }.
   */
  async recordSignals(sessionId, user, signals) {
    const session = await this.loadSession(sessionId);

    if (session.userId.toString() !== user._id.toString()) {
      throw new ApiError(403, "Only the candidate can record integrity signals.");
    }

    const list = Array.isArray(signals) ? signals.slice(0, MAX_BATCH) : [];
    if (!list.length) return { recorded: 0, skipped: 0 };

    // Most recent signal per type, to throttle client-side flapping.
    const recent = await IntegritySignal.find({ sessionId: session._id })
      .sort({ detectedAt: -1 })
      .limit(INTEGRITY_SIGNAL_TYPES.length * 3)
      .lean();
    const lastByType = new Map();
    for (const r of recent) {
      if (!lastByType.has(r.signalType)) lastByType.set(r.signalType, new Date(r.detectedAt).getTime());
    }

    const docs = [];
    let skipped = 0;
    for (const raw of list) {
      const signalType = String(raw?.signalType || raw?.type || "").trim();
      if (!INTEGRITY_SIGNAL_TYPES.includes(signalType)) {
        skipped++;
        continue;
      }
      const detectedAt = raw?.detectedAt ? new Date(raw.detectedAt) : new Date();
      const at = detectedAt.getTime();
      const prev = lastByType.get(signalType);
      if (prev != null && Math.abs(at - prev) < DEDUP_WINDOW_MS) {
        skipped++;
        continue;
      }
      lastByType.set(signalType, at);
      docs.push({
        sessionId: session._id,
        interviewId: session.interviewId,
        signalType,
        detectedAt,
        metadata: raw?.metadata ?? null,
      });
    }

    if (docs.length) {
      try {
        await IntegritySignal.insertMany(docs, { ordered: false });
      } catch (err) {
        logger.warn(`IntegritySignal insert partial failure (non-fatal): ${err.message}`);
      }
    }
    return { recorded: docs.length, skipped };
  }

  /** Owner / org / admin: raw signals + a descriptive per-type summary. */
  async getSignalsForSession(sessionId, user) {
    const session = await this.loadSession(sessionId);
    await assertCanViewSession(user, session);

    const signals = await IntegritySignal.find({ sessionId: session._id })
      .sort({ detectedAt: 1 })
      .lean();

    return {
      interviewId: session.interviewId,
      total: signals.length,
      summary: this.summarize(signals),
      signals: signals.map((s) => ({
        signalType: s.signalType,
        label: SIGNAL_LABELS[s.signalType] || s.signalType,
        detectedAt: s.detectedAt,
        metadata: s.metadata || null,
      })),
    };
  }

  /**
   * Plain counts per signal type — descriptive metadata only, never a
   * score or verdict. Safe to embed in interview results.
   */
  summarize(signals) {
    const byType = new Map();
    for (const s of signals) {
      const cur = byType.get(s.signalType) || { count: 0, lastAt: null };
      cur.count += 1;
      const at = new Date(s.detectedAt);
      if (!cur.lastAt || at > cur.lastAt) cur.lastAt = at;
      byType.set(s.signalType, cur);
    }
    return [...byType.entries()].map(([signalType, v]) => ({
      signalType,
      label: SIGNAL_LABELS[signalType] || signalType,
      count: v.count,
      lastAt: v.lastAt,
    }));
  }

  /** Summary for a session id, for embedding in results. Non-fatal -> []. */
  async summaryForSession(sessionMongoId) {
    try {
      const signals = await IntegritySignal.find({ sessionId: sessionMongoId })
        .select("signalType detectedAt")
        .lean();
      return this.summarize(signals);
    } catch (err) {
      logger.warn(`Integrity summary failed (non-fatal): ${err.message}`);
      return [];
    }
  }
}

export const integrityService = new IntegrityService();
export default integrityService;
