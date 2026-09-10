import logger from "../config/logger.js";
import { verifyAccessToken } from "../modules/auth/utils/token.service.js";
import { interviewSessionService } from "../ai-interview/services/interview-session.service.js";
import { integrityService } from "../ai-interview/services/integrity.service.js";

/**
 * Real-time channel for the AI interview room. It's a thin transport over
 * the exact same service methods the REST controller calls — the REST
 * endpoints stay fully functional as a fallback, and nothing here holds
 * interview logic of its own.
 *
 * Handshake: socket.handshake.auth.token = <JWT access token> (same as
 * /assigned-tests). Client then emits "interview:join" with { sessionId }.
 */
export const setupAiInterviewSocket = (io) => {
  const nsp = io.of("/ai-interview");

  nsp.use((socket, next) => {
    try {
      const decoded = verifyAccessToken(socket.handshake.auth?.token);
      socket.user = {
        _id: decoded.id,
        role: decoded.role,
        organizationId: decoded.organizationId ?? null,
      };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  nsp.on("connection", (socket) => {
    const { user } = socket;
    logger.info(`ai-interview socket connected: user ${user._id}`);

    const fail = (err, event) => {
      const status = err?.statusCode || 500;
      socket.emit("interview:error", {
        event,
        status,
        message: err?.message || "Something went wrong.",
      });
    };

    // Bind the socket to one interview room after an ownership check.
    socket.on("interview:join", async ({ sessionId } = {}, ack) => {
      try {
        const session = await interviewSessionService.getSessionById(sessionId, user);
        socket.interviewId = session.interviewId;
        socket.sessionId = sessionId;
        socket.join(`interview:${session.interviewId}`);
        const payload = {
          interviewId: session.interviewId,
          interviewState: session.interviewState,
          currentQuestion: session.currentQuestion || null,
        };
        socket.emit("interview:joined", payload);
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        fail(err, "interview:join");
        if (typeof ack === "function") ack({ ok: false, message: err?.message });
      }
    });

    socket.on("interview:start", async ({ sessionId } = {}, ack) => {
      try {
        const id = sessionId || socket.sessionId;
        const data = await interviewSessionService.startInterview(id, user);
        socket.emit("interview:question", data);
        if (typeof ack === "function") ack({ ok: true, ...data });
      } catch (err) {
        fail(err, "interview:start");
        if (typeof ack === "function") ack({ ok: false, message: err?.message });
      }
    });

    // Save the answer, then run the adaptive next-action — mirrors the
    // REST 2-call sequence (POST /answers then POST /next).
    socket.on("interview:answer", async (payload = {}, ack) => {
      const id = payload.sessionId || socket.sessionId;
      try {
        await interviewSessionService.submitAnswer(id, user, {
          questionId: payload.questionId,
          answer: payload.answer,
          transcript: payload.transcript,
          timeTakenSeconds: payload.timeTakenSeconds,
          timedOut: payload.timedOut,
          reason: payload.reason,
        });
        socket.emit("interview:evaluating", { sessionId: id });

        const next = await interviewSessionService.processNextAction(id, user);
        const finished =
          next.interviewState === "COMPLETED" || next.nextAction === "COMPLETE_INTERVIEW";
        socket.emit(finished ? "interview:complete" : "interview:question", next);
        if (typeof ack === "function") ack({ ok: true, finished, ...next });
      } catch (err) {
        fail(err, "interview:answer");
        if (typeof ack === "function") ack({ ok: false, message: err?.message });
      }
    });

    socket.on("interview:integrity", async ({ sessionId, signals } = {}, ack) => {
      try {
        const id = sessionId || socket.sessionId;
        const data = await integrityService.recordSignals(id, user, signals);
        if (typeof ack === "function") ack({ ok: true, ...data });
      } catch (err) {
        // Proctoring must never disrupt the room — report, don't throw.
        if (typeof ack === "function") ack({ ok: false, message: err?.message });
      }
    });

    socket.on("disconnect", () => {
      logger.info(`ai-interview socket disconnected: user ${user._id}`);
    });
  });
};

export default setupAiInterviewSocket;
