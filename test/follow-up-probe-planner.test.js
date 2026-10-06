import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { followUpProbePlannerService } from "../src/ai-interview/services/follow-up-probe-planner.service.js";
import { questionService } from "../src/ai-interview/services/question.service.js";
import { InterviewSession } from "../src/ai-interview/schemas/interview-session.schema.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";

describe("Sprint 6: In-Flight Follow-Up Probe Planner", () => {
  test("1. synthesizeProbes generates targeted domain probes with correct metadata", () => {
    const qNode = {
      id: "q-node-1",
      topic: "NODE.JS",
      questionText: "Explain how the libuv event loop handles asynchronous operations.",
      difficulty: Difficulty.HARD,
    };

    const probes = followUpProbePlannerService.synthesizeProbes(qNode, "Senior Backend Engineer");

    assert.ok(probes.length >= 2, "Should generate at least 2 candidate probes");
    assert.ok(probes.every((p) => p.status === "READY"), "All synthesized probes should be READY");
    assert.ok(probes.every((p) => p.parentQuestionId === "q-node-1"), "Parent question ID must match");
    assert.ok(probes.some((p) => p.probeType === "DEPTH_PROBE" && p.probeReason === "MISSING_CONCEPT"));
    assert.ok(probes.some((p) => p.probeType === "PRACTICAL" && p.probeReason === "PRACTICAL_DEPTH"));

    // PostgreSQL MVCC test
    const qPg = {
      id: "q-pg-1",
      topic: "POSTGRESQL",
      questionText: "How does PostgreSQL implement Multi-Version Concurrency Control (MVCC)?",
      difficulty: Difficulty.HARD,
    };
    const pgProbes = followUpProbePlannerService.synthesizeProbes(qPg);
    assert.ok(pgProbes.some((p) => p.targetConcept.toLowerCase().includes("vacuum")));

    // Redis Persistence test
    const qRedis = {
      id: "q-redis-1",
      topic: "REDIS",
      questionText: "Compare Redis RDB vs AOF persistence strategies.",
      difficulty: Difficulty.MEDIUM,
    };
    const redisProbes = followUpProbePlannerService.synthesizeProbes(qRedis);
    assert.ok(redisProbes.some((p) => p.targetConcept.toLowerCase().includes("fsync")));
  });

  test("2. claimMatchingProbe claims matching probe and skips already demonstrated concepts", async () => {
    const fakeSessionId = new mongoose.Types.ObjectId();
    const parentQId = "q-redis-persistence";

    const initialProbes = [
      {
        probeId: "probe-rdb-cow",
        parentQuestionId: parentQId,
        topic: "REDIS",
        difficulty: "HARD",
        targetConcept: "fork copy-on-write memory overhead",
        probeType: "PRACTICAL",
        probeReason: "PRACTICAL_DEPTH",
        question: "What causes Redis memory usage to spike during background RDB fork()?",
        status: "READY",
      },
      {
        probeId: "probe-aof-fsync",
        parentQuestionId: parentQId,
        topic: "REDIS",
        difficulty: "HARD",
        targetConcept: "AOF fsync policies trade-offs",
        probeType: "DEPTH_PROBE",
        probeReason: "MISSING_CONCEPT",
        question: "How do Redis fsync policies ('always', 'everysec', 'no') balance durability?",
        status: "READY",
      },
    ];

    // Mock session document
    const mockSession = {
      _id: fakeSessionId,
      prefetchedProbes: [...initialProbes],
    };

    // Candidate already answered about fsync policies, but missed copy-on-write
    const analysisResult = {
      conceptsDemonstrated: ["AOF fsync policies", "RDB snapshots"],
      conceptsMissing: ["copy-on-write"],
    };

    const decision = {
      followUpReason: "PRACTICAL_DEPTH",
      followUpType: "PRACTICAL",
      difficulty: "HARD",
    };

    // Stub Mongoose findById & updateOne for unit test
    const origFindById = InterviewSession.findById;
    const origUpdateOne = InterviewSession.updateOne;

    InterviewSession.findById = () => ({
      select: () => ({
        lean: async () => mockSession,
      }),
    });

    let updatedProbeStatus = null;
    InterviewSession.updateOne = async (query, update) => {
      if (query["prefetchedProbes.probeId"] && update.$set?.["prefetchedProbes.$.status"]) {
        updatedProbeStatus = update.$set["prefetchedProbes.$.status"];
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 0 };
    };

    try {
      const claimed = await followUpProbePlannerService.claimMatchingProbe(
        mockSession,
        parentQId,
        decision,
        analysisResult
      );

      assert.ok(claimed, "Should claim matching probe");
      assert.equal(claimed.probeId, "probe-rdb-cow");
      assert.equal(claimed.questionSource, "prefetched_probe");
      assert.equal(updatedProbeStatus, "USED");
    } finally {
      InterviewSession.findById = origFindById;
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  test("3. claimMatchingProbe returns null when no probe matches, triggering dynamic fallback", async () => {
    const mockSession = {
      _id: new mongoose.Types.ObjectId(),
      prefetchedProbes: [], // No ready probes
    };

    const origFindById = InterviewSession.findById;
    InterviewSession.findById = () => ({
      select: () => ({
        lean: async () => mockSession,
      }),
    });

    try {
      const claimed = await followUpProbePlannerService.claimMatchingProbe(
        mockSession,
        "q-none",
        { followUpReason: "MISSING_CONCEPT", followUpType: "DEPTH_PROBE" },
        {}
      );

      assert.equal(claimed, null, "Should return null when no matching probe is available");
    } finally {
      InterviewSession.findById = origFindById;
    }
  });

  test("4. discardProbesForQuestion marks inactive probes as DISCARDED", async () => {
    const fakeSessionId = new mongoose.Types.ObjectId();
    let discardCalled = false;

    const origUpdateOne = InterviewSession.updateOne;
    InterviewSession.updateOne = async (query, update, options) => {
      if (update.$set?.["prefetchedProbes.$[elem].status"] === "DISCARDED") {
        discardCalled = true;
        return { modifiedCount: 2 };
      }
      return { modifiedCount: 0 };
    };

    try {
      await followUpProbePlannerService.discardProbesForQuestion(fakeSessionId, "q-old");
      assert.ok(discardCalled, "Should issue update to discard probes for old question");
    } finally {
      InterviewSession.updateOne = origUpdateOne;
    }
  });

  test("5. claimMatchingProbe strictly returns null on misconceptions or contradictions", async () => {
    const mockSession = {
      _id: new mongoose.Types.ObjectId(),
      prefetchedProbes: [
        {
          probeId: "probe-redis",
          parentQuestionId: "q-redis",
          status: "READY",
          targetConcept: "AOF fsync",
          probeType: "DEPTH_PROBE",
          probeReason: "MISSING_CONCEPT",
        },
      ],
    };

    const origFindById = InterviewSession.findById;
    InterviewSession.findById = () => ({
      select: () => ({
        lean: async () => mockSession,
      }),
    });

    try {
      // 5a. Misconception follow-up reason
      const claimedMisconception = await followUpProbePlannerService.claimMatchingProbe(
        mockSession,
        "q-redis",
        { followUpReason: "MISCONCEPTION", followUpType: "DEPTH_PROBE" },
        { misconceptions: ["Cluster has automatic ACID across all hash slots"] }
      );
      assert.equal(claimedMisconception, null, "Should return null on MISCONCEPTION to trigger dynamic question gen");

      // 5b. Contradiction detected
      const claimedContradiction = await followUpProbePlannerService.claimMatchingProbe(
        mockSession,
        "q-redis",
        { followUpReason: "CONTRADICTION", followUpType: "DEPTH_PROBE" },
        { contradictionDetected: true }
      );
      assert.equal(claimedContradiction, null, "Should return null on CONTRADICTION to trigger dynamic question gen");
    } finally {
      InterviewSession.findById = origFindById;
    }
  });
});
