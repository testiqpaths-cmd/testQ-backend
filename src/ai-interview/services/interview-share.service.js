import crypto from "crypto";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { assertCanViewSession } from "../utils/authorize.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const DEFAULT_TTL_HOURS = 168; // 7 days
const MAX_TTL_HOURS = 720; // 30 days

export class InterviewShareService {
  async loadSession(sessionId) {
    if (!sessionId) throw new ApiError(400, "Session ID is required.");
    const query = String(sessionId).startsWith("int-")
      ? { interviewId: sessionId }
      : { _id: sessionId };
    const session = await InterviewSession.findOne(query);
    if (!session) throw new ApiError(404, `Interview session not found: ${sessionId}`);
    return session;
  }

  /**
   * Owner / org / admin: (re)issue a single-use, time-boxed link for this
   * interview. Any previously issued token is replaced.
   */
  async createShareLink(sessionId, user, { expiresInHours } = {}) {
    const session = await this.loadSession(sessionId);
    await assertCanViewSession(user, session);

    if (["COMPLETED", "EVALUATED", "CANCELLED", "EXPIRED"].includes(session.interviewState)) {
      throw new ApiError(400, "This interview has already finished — a share link would do nothing.");
    }

    const ttl = Math.min(Math.max(Number(expiresInHours) || DEFAULT_TTL_HOURS, 1), MAX_TTL_HOURS);
    const token = crypto.randomBytes(24).toString("base64url");

    session.shareToken = token;
    session.shareTokenExpiresAt = new Date(Date.now() + ttl * 3600 * 1000);
    session.shareTokenUsedAt = null;
    session.shareTokenCreatedBy = user._id;
    await session.save();

    logger.info(`Share link issued for interview ${session.interviewId} by ${user._id}`);
    return {
      token,
      path: `/ai-interview/join/${token}`,
      expiresAt: session.shareTokenExpiresAt,
      alreadyUsed: false,
    };
  }

  async revokeShareLink(sessionId, user) {
    const session = await this.loadSession(sessionId);
    await assertCanViewSession(user, session);
    session.shareToken = null;
    session.shareTokenExpiresAt = null;
    session.shareTokenUsedAt = null;
    await session.save();
    return { revoked: true };
  }

  #findByToken(token) {
    if (!token) throw new ApiError(400, "A link token is required.");
    return InterviewSession.findOne({ shareToken: token });
  }

  #assertLinkUsable(session) {
    if (!session) throw new ApiError(404, "This interview link is not valid.");
    if (session.shareTokenExpiresAt && session.shareTokenExpiresAt.getTime() < Date.now()) {
      throw new ApiError(410, "This interview link has expired.");
    }
    if (session.shareTokenUsedAt) {
      throw new ApiError(410, "This interview link has already been used.");
    }
  }

  /**
   * Read-only preview of a link for a landing page. Does NOT consume it.
   */
  async peekShareLink(token) {
    const session = await this.#findByToken(token);
    this.#assertLinkUsable(session);
    return {
      valid: true,
      interviewId: session.interviewId,
      role: session.role,
      company: session.company,
      durationMinutes: session.duration,
      interviewState: session.interviewState,
      expiresAt: session.shareTokenExpiresAt,
    };
  }

  /**
   * Consume the link. The opener must be the candidate the interview
   * belongs to; the token is burned on success so it can't be reused.
   */
  async consumeShareLink(token, user) {
    const session = await this.#findByToken(token);
    this.#assertLinkUsable(session);

    if (session.userId.toString() !== user._id.toString()) {
      throw new ApiError(403, "This interview link was issued for a different account.");
    }

    session.shareTokenUsedAt = new Date();
    await session.save();

    return {
      interviewId: session.interviewId,
      sessionId: session._id.toString(),
      interviewState: session.interviewState,
      role: session.role,
    };
  }
}

export const interviewShareService = new InterviewShareService();
export default interviewShareService;
