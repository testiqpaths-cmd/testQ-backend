import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { interviewSessionService, InterviewSessionService } from "../src/ai-interview/services/interview-session.service.js";
import { aiInterviewController } from "../src/ai-interview/controllers/ai-interview.controller.js";
import aiInterviewRouter from "../src/ai-interview/ai-interview.routes.js";

test("Sprint 3 Fast Interaction Path (submitAnswerAndNext)", async (t) => {
  const mockUser = {
    _id: new mongoose.Types.ObjectId().toString(),
    role: "CANDIDATE",
  };
  const testSessionId = new mongoose.Types.ObjectId().toString();

  await t.test("aiInterviewController.submitAnswerAndNext delegates to interviewSessionService and returns 200 JSON", async () => {
    const origMethod = interviewSessionService.submitAnswerAndNext;
    let serviceCalledWith = null;

    try {
      interviewSessionService.submitAnswerAndNext = async (sessionId, user, payload) => {
        serviceCalledWith = { sessionId, user, payload };
        return {
          session: { _id: sessionId },
          nextAction: "ASK_QUESTION",
          question: { questionId: "prep-turn-2", text: "Explain Node.js event loop phases." },
        };
      };

      const mockReq = {
        params: { id: testSessionId },
        user: mockUser,
        body: { answerText: "Redis operates as an in-memory key-value store." },
      };

      let statusCode = null;
      let jsonBody = null;
      const mockRes = {
        status(code) {
          statusCode = code;
          return {
            json(data) {
              jsonBody = data;
            },
          };
        },
      };

      await aiInterviewController.submitAnswerAndNext(mockReq, mockRes, (err) => {
        if (err) throw err;
      });

      assert.equal(statusCode, 200, "Should return HTTP 200");
      assert.equal(jsonBody.success, true);
      assert.equal(serviceCalledWith.sessionId, testSessionId);
      assert.equal(serviceCalledWith.user, mockUser);
      assert.equal(serviceCalledWith.payload.answerText, "Redis operates as an in-memory key-value store.");
      assert.equal(jsonBody.data.question.questionId, "prep-turn-2");
    } finally {
      interviewSessionService.submitAnswerAndNext = origMethod;
    }
  });

  await t.test("aiInterviewController.submitAnswerAndNext propagates service errors to next()", async () => {
    const origMethod = interviewSessionService.submitAnswerAndNext;
    let errorPassed = null;

    try {
      interviewSessionService.submitAnswerAndNext = async () => {
        throw new Error("Session lock acquisition failed");
      };

      const mockReq = {
        params: { id: testSessionId },
        user: mockUser,
        body: {},
      };
      const mockRes = {};

      await aiInterviewController.submitAnswerAndNext(mockReq, mockRes, (err) => {
        errorPassed = err;
      });

      assert.ok(errorPassed instanceof Error);
      assert.equal(errorPassed.message, "Session lock acquisition failed");
    } finally {
      interviewSessionService.submitAnswerAndNext = origMethod;
    }
  });

  await t.test("Fastpath routes are registered in aiInterviewRouter", () => {
    const routes = [];
    aiInterviewRouter.stack.forEach((layer) => {
      if (layer.route) {
        routes.push({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        });
      }
    });

    const directSubmitAndNext = routes.find(
      (r) => r.path === "/:id/submit-and-next" && r.methods.includes("post")
    );
    const sessionSubmitAndNext = routes.find(
      (r) => r.path === "/sessions/:id/submit-and-next" && r.methods.includes("post")
    );

    assert.ok(directSubmitAndNext, "Route POST /:id/submit-and-next must be registered");
    assert.ok(sessionSubmitAndNext, "Route POST /sessions/:id/submit-and-next must be registered");
  });

  await t.test("InterviewSessionService defines submitAnswerAndNext as atomic pipeline", () => {
    const service = new InterviewSessionService();
    assert.equal(typeof service.submitAnswerAndNext, "function", "submitAnswerAndNext must be an async method on InterviewSessionService");
  });
});
