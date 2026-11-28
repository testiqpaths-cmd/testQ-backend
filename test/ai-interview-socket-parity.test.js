import test from "node:test";
import assert from "node:assert/strict";

import { setupAiInterviewSocket } from "../src/sockets/aiInterviewSocket.js";
import { interviewSessionService } from "../src/modules/ai-interview/services/interview-session.service.js";
import { interviewSessionService as shimService } from "../src/ai-interview/services/interview-session.service.js";
import { aiInterviewController } from "../src/modules/ai-interview/controllers/ai-interview.controller.js";

/**
 * The socket transport must run exactly the same planner/engine code as
 * REST: both call the one interviewSessionService instance, so phase plans,
 * buffering and follow-up behaviour cannot drift between them.
 */
function fakeIo() {
  let onConnection = null;
  const nsp = {
    use() {},
    on(event, fn) {
      if (event === "connection") onConnection = fn;
    },
  };
  return {
    io: { of: () => nsp },
    connect(user) {
      const handlers = {};
      const emitted = [];
      const socket = {
        user,
        on: (event, fn) => {
          handlers[event] = fn;
        },
        emit: (event, payload) => emitted.push({ event, payload }),
        join() {},
      };
      onConnection(socket);
      return { handlers, emitted, socket };
    },
  };
}

test("Socket and REST interviews share one session service", async (t) => {
  await t.test("the legacy import path resolves to the same singleton", () => {
    assert.equal(shimService, interviewSessionService);
  });

  await t.test("interview:start and interview:answer delegate to the same methods the REST controller calls", async () => {
    const calls = [];
    const orig = {
      start: interviewSessionService.startInterview,
      next: interviewSessionService.submitAnswerAndNext,
    };
    interviewSessionService.startInterview = async (id, user) => {
      calls.push(["start", id, String(user._id)]);
      return { phase: "INTRODUCTION", currentQuestion: { topic: "INTRODUCTION" } };
    };
    interviewSessionService.submitAnswerAndNext = async (id, user, payload) => {
      calls.push(["next", id, String(user._id), payload.answer]);
      return { phase: "PROFESSIONAL_EXPERIENCE", nextAction: "SWITCH_TOPIC", interviewState: "IN_PROGRESS" };
    };

    try {
      const { io, connect } = fakeIo();
      setupAiInterviewSocket(io);
      const { handlers, emitted, socket } = connect({ _id: "u1", role: "STUDENT" });
      socket.sessionId = "s1";

      const startAck = await new Promise((resolve) => handlers["interview:start"]({ sessionId: "s1" }, resolve));
      assert.equal(startAck.ok, true);
      const answerAck = await new Promise((resolve) =>
        handlers["interview:answer"]({ sessionId: "s1", questionId: "q1", answer: "hello" }, resolve)
      );
      assert.equal(answerAck.ok, true);
      assert.equal(answerAck.phase, "PROFESSIONAL_EXPERIENCE");
      assert.ok(emitted.some((e) => e.event === "interview:question"));

      // REST path hits the very same stubs.
      const res = { status: () => res, json: (b) => (res.body = b) };
      await aiInterviewController.startInterview({ params: { id: "s1" }, user: { _id: "u2" } }, res, (e) => { throw e; });
      await aiInterviewController.submitAnswerAndNext(
        { params: { id: "s1" }, user: { _id: "u2" }, body: { questionId: "q1", answer: "rest" } },
        res,
        (e) => { throw e; }
      );

      assert.deepEqual(calls.map((c) => c[0]), ["start", "next", "start", "next"]);
      assert.equal(calls[1][3], "hello");
      assert.equal(calls[3][3], "rest");
    } finally {
      interviewSessionService.startInterview = orig.start;
      interviewSessionService.submitAnswerAndNext = orig.next;
    }
  });
});
