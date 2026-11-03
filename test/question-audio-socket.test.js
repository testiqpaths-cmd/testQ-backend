import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import { setupSockets, getIO } from "../src/sockets/index.js";
import { questionAudioService as canonicalService } from "../src/modules/ai-interview/tts/question-audio.service.js";
import { questionAudioService as shimService } from "../src/ai-interview/tts/question-audio.service.js";
import { InterviewTurn } from "../src/modules/ai-interview/schemas/interview-turn.schema.js";

test("QuestionAudioService Socket Notification & Module Resolution", async (t) => {
  let server;
  let io;

  t.before(() => {
    server = http.createServer();
    io = setupSockets(server);
  });

  t.after(() => {
    if (io) {
      io.close();
    }
    if (server) {
      server.close();
    }
  });

  await t.test("Verify canonical and shim service exports are identical", () => {
    assert.strictEqual(canonicalService, shimService);
  });

  await t.test("prewarmForTurn resolves socket module and emits question:audio-ready event", async () => {
    const emittedEvents = [];
    const targetRoom = "interview:test-interview-123";

    // Track room emission on /ai-interview namespace
    const namespace = io.of("/ai-interview");
    const originalTo = namespace.to.bind(namespace);
    namespace.to = (room) => {
      const roomEmitter = originalTo(room);
      return {
        ...roomEmitter,
        emit: (eventName, payload) => {
          emittedEvents.push({ room, eventName, payload });
          return roomEmitter.emit(eventName, payload);
        },
      };
    };

    // Mock InterviewTurn.updateOne
    const originalUpdateOne = InterviewTurn.updateOne;
    let updateCalledWith = null;
    InterviewTurn.updateOne = async (filter, update) => {
      updateCalledWith = { filter, update };
      return { acknowledged: true, modifiedCount: 1 };
    };

    try {
      const mockTurnId = new mongoose.Types.ObjectId().toString();
      canonicalService.prewarmForTurn(mockTurnId, "Tell me about your background in Node.js", {
        interviewId: "test-interview-123",
        turnNumber: 1,
      });

      // Wait a tick for async dynamic import to resolve
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify DB update called
      assert.ok(updateCalledWith, "InterviewTurn.updateOne was called");
      assert.strictEqual(updateCalledWith.filter._id, mockTurnId);
      assert.match(updateCalledWith.update.questionAudioUrl, /first-question\.mp3/);

      // Verify socket emission
      assert.strictEqual(emittedEvents.length, 1, "Exactly one socket event emitted");
      assert.strictEqual(emittedEvents[0].room, targetRoom);
      assert.strictEqual(emittedEvents[0].eventName, "question:audio-ready");
      assert.strictEqual(emittedEvents[0].payload.turnId, mockTurnId);
      assert.match(emittedEvents[0].payload.url, /first-question\.mp3/);
      assert.strictEqual(emittedEvents[0].payload.mimeType, "audio/mpeg");
    } finally {
      InterviewTurn.updateOne = originalUpdateOne;
      namespace.to = originalTo;
    }
  });

  await t.test("prewarmForTurn for subsequent turn uses standard prompt", async () => {
    const emittedEvents = [];
    const namespace = io.of("/ai-interview");
    const originalTo = namespace.to.bind(namespace);
    namespace.to = (room) => {
      const roomEmitter = originalTo(room);
      return {
        ...roomEmitter,
        emit: (eventName, payload) => {
          emittedEvents.push({ room, eventName, payload });
          return roomEmitter.emit(eventName, payload);
        },
      };
    };

    const originalUpdateOne = InterviewTurn.updateOne;
    InterviewTurn.updateOne = async () => ({ acknowledged: true });

    try {
      const mockTurnId = new mongoose.Types.ObjectId().toString();
      canonicalService.prewarmForTurn(mockTurnId, "What is event bubbling in JavaScript?", {
        interviewId: "test-interview-456",
        turnNumber: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(emittedEvents.length, 1);
      assert.strictEqual(emittedEvents[0].room, "interview:test-interview-456");
      assert.match(emittedEvents[0].payload.url, /here-is-the-question\.mp3/);
    } finally {
      InterviewTurn.updateOne = originalUpdateOne;
      namespace.to = originalTo;
    }
  });
});

