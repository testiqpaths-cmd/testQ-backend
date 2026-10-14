import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewQuestionPlannerService } from "../src/ai-interview/services/interview-question-planner.service.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";

test("Sprint 2 Question Preparation Layer (InterviewQuestionPlannerService)", async (t) => {
  const mockAi = {
    generateQuestion: async (ctx) => ({
      question: `Mock question for ${ctx.topic} (${ctx.difficulty}) #${Date.now()}`,
      concept: `Core ${ctx.topic}`,
      topic: ctx.topic,
      difficulty: ctx.difficulty,
      questionType: "TECHNICAL",
      competency: "Technical Knowledge",
    }),
  };

  const planner = new InterviewQuestionPlannerService(mockAi);

  // --------------------------------------------------------------------------
  // TEST 1: Blueprint-based structured topic & difficulty queue
  // --------------------------------------------------------------------------
  await t.test("determineTopicsToBuffer creates structured queue respecting caps and excluding INTRODUCTION", () => {
    const session = {
      currentTopic: "INTRODUCTION",
      difficulty: Difficulty.MEDIUM,
      topicOrder: ["NODE.JS", "POSTGRESQL", "REDIS"],
      preparedQuestions: [],
    };
    const plan = { maxQuestionsPerTopic: 4, topics: ["NODE.JS", "POSTGRESQL", "REDIS"] };
    const pastTurns = [];

    const targets = planner.determineTopicsToBuffer(session, plan, pastTurns);

    assert.ok(Array.isArray(targets), "Targets must be an array");
    assert.equal(targets.length, 5, "Initial buffer should plan 5 targets");

    // Must NOT contain INTRODUCTION
    const introTargets = targets.filter((t) => t.topic === "INTRODUCTION");
    assert.equal(introTargets.length, 0, "Buffer must never plan INTRODUCTION questions");

    // First planned topic should get 2 slots (Medium & Hard)
    const nodeTargets = targets.filter((t) => t.topic === "NODE.JS");
    assert.equal(nodeTargets.length, 2, "Active topic (Node.js) should have 2 slots");
    assert.deepEqual(nodeTargets.map((t) => t.difficulty), ["MEDIUM", "HARD"]);

    // Subsequent topics should get slots
    const pgTargets = targets.filter((t) => t.topic === "POSTGRESQL");
    assert.equal(pgTargets.length, 2, "Second topic (PostgreSQL) should have 2 slots");

    const redisTargets = targets.filter((t) => t.topic === "REDIS");
    assert.equal(redisTargets.length, 1, "Third topic (Redis) should have 1 slot to reach 5 total");
  });

  // --------------------------------------------------------------------------
  // TEST 2: Buffer never hoards single topic when other topics need buffer
  // --------------------------------------------------------------------------
  await t.test("determineTopicsToBuffer does not exceed MAX_BUFFER_PER_TOPIC (2) per topic", () => {
    const session = {
      currentTopic: "NODE.JS",
      difficulty: Difficulty.HARD,
      topicOrder: ["NODE.JS", "POSTGRESQL", "REDIS"],
      preparedQuestions: [
        { topic: "NODE.JS", difficulty: "MEDIUM", status: "READY" },
        { topic: "NODE.JS", difficulty: "HARD", status: "READY" },
      ],
    };
    const plan = { maxQuestionsPerTopic: 4, topics: ["NODE.JS", "POSTGRESQL", "REDIS"] };
    const pastTurns = [];

    const targets = planner.determineTopicsToBuffer(session, plan, pastTurns);

    // Node.js already has 2 READY questions; buffer should allocate to PostgreSQL and Redis
    const nodeTargets = targets.filter((t) => t.topic === "NODE.JS");
    assert.equal(nodeTargets.length, 0, "Node.js already has 2 READY questions; buffer should not hoard more");

    const pgTargets = targets.filter((t) => t.topic === "POSTGRESQL");
    assert.ok(pgTargets.length >= 1, "PostgreSQL should receive buffer allocation");
  });

  // --------------------------------------------------------------------------
  // TEST 3: Respects topic exhaustion under maxQuestionsPerTopic cap
  // --------------------------------------------------------------------------
  await t.test("determineTopicsToBuffer skips topics that reached maxQuestionsPerTopic", () => {
    const session = {
      currentTopic: "NODE.JS",
      difficulty: Difficulty.MEDIUM,
      topicOrder: ["NODE.JS", "POSTGRESQL", "REDIS"],
      preparedQuestions: [],
    };
    const plan = { maxQuestionsPerTopic: 3, topics: ["NODE.JS", "POSTGRESQL", "REDIS"] };
    // 3 past turns already on Node.js
    const pastTurns = [
      { topic: "NODE.JS" },
      { topic: "NODE.JS" },
      { topic: "NODE.JS" },
    ];

    const targets = planner.determineTopicsToBuffer(session, plan, pastTurns);

    const nodeTargets = targets.filter((t) => t.topic === "NODE.JS");
    assert.equal(nodeTargets.length, 0, "Exhausted topic (3/3 asked) must receive 0 buffer targets");

    const pgTargets = targets.filter((t) => t.topic === "POSTGRESQL");
    assert.ok(pgTargets.length >= 1, "Active buffer shifts to next available topic in blueprint");
  });

  // --------------------------------------------------------------------------
  // TEST 4: Atomic Claim Matching logic (Exact match & Fallback match)
  // --------------------------------------------------------------------------
  await t.test("claimPreparedQuestion matches exact topic & difficulty, falling back to topic", async () => {
    const origFindOneAndUpdate = InterviewSession.findOneAndUpdate;
    const origUpdateOne = InterviewSession.updateOne;
    InterviewSession.updateOne = async () => ({ modifiedCount: 0 });

    const testSessionId = new mongoose.Types.ObjectId().toString();
    try {
      // Mock session document with 2 ready questions
      const mockDoc = {
        _id: testSessionId,
        preparedQuestions: [
          { questionId: "prep-1", topic: "NODE.JS", difficulty: "MEDIUM", status: "READY" },
          { questionId: "prep-2", topic: "NODE.JS", difficulty: "HARD", status: "READY" },
        ],
      };

      // 4a. Exact match for HARD
      InterviewSession.findOneAndUpdate = async (filter, update, opts) => {
        // Assert atomic filter includes $elemMatch with READY status
        assert.ok(filter.preparedQuestions.$elemMatch, "Filter must use $elemMatch");
        assert.equal(filter.preparedQuestions.$elemMatch.status, "READY");
        return mockDoc;
      };

      const claimedExact = await planner.claimPreparedQuestion(testSessionId, {
        topic: "NODE.JS",
        difficulty: "HARD",
      });

      assert.ok(claimedExact, "Claimed question must be returned");
      assert.equal(claimedExact.questionId, "prep-2", "Must match exact requested difficulty (HARD)");
      assert.equal(claimedExact.status, "CLAIMED");

      // 4b. Non-matching topic returns null
      InterviewSession.findOneAndUpdate = async () => null;
      const claimedNone = await planner.claimPreparedQuestion(testSessionId, {
        topic: "GOLANG",
        difficulty: "MEDIUM",
      });
      assert.equal(claimedNone, null, "Unmatched topic must return null without error");
    } finally {
      InterviewSession.findOneAndUpdate = origFindOneAndUpdate;
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 5: State Transitions (READY -> CLAIMED -> USED)
  // --------------------------------------------------------------------------
  await t.test("markQuestionUsed and discardQuestion issue atomic $set updates", async () => {
    const origUpdateOne = InterviewSession.updateOne;
    const testSessionId = new mongoose.Types.ObjectId().toString();
    const calls = [];

    InterviewSession.updateOne = async (filter, update) => {
      calls.push({ filter, update });
      return { modifiedCount: 1 };
    };

    try {
      await planner.markQuestionUsed(testSessionId, "prep-1");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].filter["preparedQuestions.questionId"], "prep-1");
      assert.equal(calls[0].update.$set["preparedQuestions.$.status"], "USED");

      await planner.discardQuestion(testSessionId, "prep-2");
      assert.equal(calls.length, 2);
      assert.equal(calls[1].filter["preparedQuestions.questionId"], "prep-2");
      assert.equal(calls[1].update.$set["preparedQuestions.$.status"], "DISCARDED");
    } finally {
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 6: Session Idempotency Lock
  // --------------------------------------------------------------------------
  await t.test("replenishPool aborts cleanly if lock is held by concurrent worker", async () => {
    const origFindOneAndUpdate = InterviewSession.findOneAndUpdate;

    try {
      // Simulate lock acquisition failure (already locked)
      InterviewSession.findOneAndUpdate = async () => null;

      let aiCalled = false;
      const customPlanner = new InterviewQuestionPlannerService({
        generateQuestion: async () => {
          aiCalled = true;
          return null;
        },
      });

      const testSessionId = new mongoose.Types.ObjectId().toString();
      await customPlanner.replenishPool(testSessionId);
      assert.equal(aiCalled, false, "Replenishment must abort immediately when lock is held");
    } finally {
      InterviewSession.findOneAndUpdate = origFindOneAndUpdate;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 7: Stale Claim Lease Recovery (CLAIMED with expired TTL -> READY)
  // --------------------------------------------------------------------------
  await t.test("recoverStaleClaims restores expired CLAIMED questions back to READY", async () => {
    const origUpdateOne = InterviewSession.updateOne;
    const testSessionId = new mongoose.Types.ObjectId().toString();
    let filterSeen = null;
    let updateSeen = null;

    InterviewSession.updateOne = async (filter, update, opts) => {
      filterSeen = filter;
      updateSeen = update;
      return { modifiedCount: 1 };
    };

    try {
      const recovered = await planner.recoverStaleClaims(testSessionId);
      assert.equal(recovered, 1, "Should report recovered question count");
      assert.equal(filterSeen.preparedQuestions.$elemMatch.status, "CLAIMED");
      assert.ok(filterSeen.preparedQuestions.$elemMatch.claimExpiresAt.$lt instanceof Date);
      assert.equal(updateSeen.$set["preparedQuestions.$[elem].status"], "READY");
      assert.equal(updateSeen.$set["preparedQuestions.$[elem].claimOwner"], null);
      assert.equal(updateSeen.$set["preparedQuestions.$[elem].claimExpiresAt"], null);
    } finally {
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 8: Explicit releaseClaim (e.g. if turn creation fails)
  // --------------------------------------------------------------------------
  await t.test("releaseClaim resets claimed question back to READY", async () => {
    const origUpdateOne = InterviewSession.updateOne;
    const testSessionId = new mongoose.Types.ObjectId().toString();
    let filterSeen = null;
    let updateSeen = null;

    InterviewSession.updateOne = async (filter, update) => {
      filterSeen = filter;
      updateSeen = update;
      return { modifiedCount: 1 };
    };

    try {
      await planner.releaseClaim(testSessionId, "prep-fail");
      assert.equal(filterSeen["preparedQuestions.questionId"], "prep-fail");
      assert.equal(filterSeen["preparedQuestions.status"], "CLAIMED");
      assert.equal(updateSeen.$set["preparedQuestions.$.status"], "READY");
      assert.equal(updateSeen.$set["preparedQuestions.$.claimOwner"], null);
    } finally {
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 9: Claim stores claimOwner and claimExpiresAt
  // --------------------------------------------------------------------------
  await t.test("claimPreparedQuestion persists claimOwner and claimExpiresAt", async () => {
    const origFindOneAndUpdate = InterviewSession.findOneAndUpdate;
    const origUpdateOne = InterviewSession.updateOne;
    InterviewSession.updateOne = async () => ({ modifiedCount: 0 });
    const testSessionId = new mongoose.Types.ObjectId().toString();

    try {
      let updateExecuted = null;
      InterviewSession.findOneAndUpdate = async (filter, update) => {
        updateExecuted = update;
        return {
          _id: testSessionId,
          preparedQuestions: [
            { questionId: "prep-ttl", topic: "REDIS", difficulty: "MEDIUM", status: "READY" },
          ],
        };
      };

      const claimed = await planner.claimPreparedQuestion(testSessionId, {
        topic: "REDIS",
        difficulty: "MEDIUM",
        owner: "worker-abc",
      });

      assert.ok(claimed, "Should claim question");
      assert.equal(claimed.claimOwner, "worker-abc");
      assert.ok(claimed.claimExpiresAt instanceof Date);
      assert.equal(updateExecuted.$set["preparedQuestions.$.claimOwner"], "worker-abc");
      assert.ok(updateExecuted.$set["preparedQuestions.$.claimExpiresAt"] instanceof Date);
    } finally {
      InterviewSession.findOneAndUpdate = origFindOneAndUpdate;
      InterviewSession.updateOne = origUpdateOne;
    }
  });
});
