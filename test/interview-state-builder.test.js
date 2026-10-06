import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { interviewStateBuilderService } from "../src/ai-interview/services/interview-state-builder.service.js";

describe("InterviewStateBuilderService Unit Tests", () => {
  test("builds empty state when no previous turns exist", () => {
    const session = {
      role: "Backend Engineer",
      experienceLevel: "Senior",
      techStack: ["Node.js", "Redis"],
      currentTopic: "Node.js",
      difficulty: "MEDIUM",
    };

    const state = interviewStateBuilderService.buildState(session, []);

    assert.equal(state.totalTurnsCompleted, 0);
    assert.deepEqual(state.testedConcepts, []);
    assert.deepEqual(state.misconceptions, []);
    assert.deepEqual(state.missingConcepts, []);
    assert.deepEqual(state.topicMastery, {});
    assert.equal(state.recentTurns.length, 0);
    assert.equal(state.resumeClaimsValidated.length, 2);
    assert.equal(state.resumeClaimsValidated[0].status, "UNPROVEN");

    const promptText = interviewStateBuilderService.formatStateForPrompt(state);
    assert.equal(promptText, "");
  });

  test("aggregates multiple turns with provenance, topic mastery, and misconceptions", () => {
    const session = {
      role: "Senior Backend Engineer",
      resumeData: {
        extracted: { skills: ["Node.js", "PostgreSQL", "Redis"] },
      },
      techStack: ["Node.js", "PostgreSQL", "Redis"],
    };

    const turns = [
      {
        turnNumber: 1,
        topic: "NODE.JS",
        concept: "Event Loop",
        question: "How does the event loop handle timers and I/O?",
        candidateAnswer: "The event loop has distinct phases: timers, pending callbacks, poll, check, and close. setImmediate runs in check.",
        correctnessScore: 90,
        completenessScore: 85,
        depthLevel: "DEEP",
        conceptsDemonstrated: ["Event Loop", "setImmediate", "Poll Phase"],
        conceptsMissing: [],
        misconceptions: [],
      },
      {
        turnNumber: 2,
        topic: "NODE.JS",
        concept: "Worker Threads",
        question: "When would you use worker threads instead of clustering?",
        candidateAnswer: "Worker threads share memory via SharedArrayBuffer for CPU-heavy tasks.",
        correctnessScore: 80,
        completenessScore: 75,
        depthLevel: "ADEQUATE",
        conceptsDemonstrated: ["Worker Threads", "SharedArrayBuffer"],
        conceptsMissing: ["Atomics"],
        misconceptions: [],
      },
      {
        turnNumber: 3,
        topic: "REDIS",
        concept: "Persistence",
        question: "Explain RDB vs AOF persistence trade-offs.",
        candidateAnswer: "Redis saves memory snapshots in RDB. But AOF runs in the background with zero disk overhead.",
        correctnessScore: 60,
        completenessScore: 50,
        depthLevel: "SHALLOW",
        conceptsDemonstrated: ["RDB snapshots"],
        conceptsMissing: ["fsync policies"],
        misconceptions: ["AOF has zero disk overhead"],
      },
    ];

    const state = interviewStateBuilderService.buildState(session, turns);

    // 1. Total turns
    assert.equal(state.totalTurnsCompleted, 3);

    // 2. Tested concepts with provenance
    assert.ok(state.testedConcepts.some((c) => c.concept === "Event Loop" && c.turn === 1));
    assert.ok(state.testedConcepts.some((c) => c.concept === "Worker Threads" && c.turn === 2));
    assert.ok(state.testedConcepts.some((c) => c.concept === "RDB snapshots" && c.turn === 3));

    // 3. Misconceptions with provenance
    assert.equal(state.misconceptions.length, 1);
    assert.equal(state.misconceptions[0].claim, "AOF has zero disk overhead");
    assert.equal(state.misconceptions[0].turn, 3);

    // 4. Missing concepts with provenance
    assert.ok(state.missingConcepts.some((m) => m.concept === "Atomics" && m.turn === 2));
    assert.ok(state.missingConcepts.some((m) => m.concept === "fsync policies" && m.turn === 3));

    // 5. Topic mastery preserves evidence turns
    assert.ok(state.topicMastery["NODE.JS"]);
    assert.equal(state.topicMastery["NODE.JS"].level, "EXCELLENT");
    assert.deepEqual(state.topicMastery["NODE.JS"].evidenceTurns, [1, 2]);
    assert.ok(state.topicMastery["REDIS"]);
    assert.deepEqual(state.topicMastery["REDIS"].evidenceTurns, [3]);

    // 6. Resume claims validation
    const nodeClaim = state.resumeClaimsValidated.find((c) => c.claim.toLowerCase().includes("node"));
    assert.ok(nodeClaim);
    assert.equal(nodeClaim.status, "SUPPORTED");
    assert.equal(nodeClaim.evidenceTurn, 2);

    const redisClaim = state.resumeClaimsValidated.find((c) => c.claim.toLowerCase().includes("redis"));
    assert.ok(redisClaim);
    assert.equal(redisClaim.status, "PARTIALLY_SUPPORTED");
    assert.equal(redisClaim.evidenceTurn, 3);

    const pgClaim = state.resumeClaimsValidated.find((c) => c.claim.toLowerCase().includes("postgresql"));
    assert.ok(pgClaim);
    assert.equal(pgClaim.status, "UNPROVEN");
    assert.equal(pgClaim.evidenceTurn, null);

    // 7. Recent turns bounded to 2
    assert.equal(state.recentTurns.length, 2);
    assert.equal(state.recentTurns[0].turnNumber, 2);
    assert.equal(state.recentTurns[1].turnNumber, 3);

    // 8. Prompt text formatting
    const promptText = interviewStateBuilderService.formatStateForPrompt(state);
    assert.ok(promptText.includes("Structured Interview Evidence:"));
    assert.ok(promptText.includes("Verified Concepts:"));
    assert.ok(promptText.includes("Known Misconceptions:"));
    assert.ok(promptText.includes("Topic Mastery: NODE.JS"));
    assert.ok(promptText.includes("Resume Claims:"));
    assert.ok(promptText.includes("Recent Context (last 1-2 turns):"));
  });

  test("preserves evidence turns during contradictions instead of hiding them", () => {
    const session = {
      techStack: ["REDIS"],
    };

    // Candidate answered Redis well on Turn 3, but poorly on Turn 8
    const turns = [
      {
        turnNumber: 3,
        topic: "REDIS",
        concept: "Data structures",
        question: "Explain Redis sorted sets and their time complexity.",
        candidateAnswer: "Redis sorted sets use a skiplist and hash table. ZADD is O(log N).",
        correctnessScore: 95,
        completenessScore: 90,
        depthLevel: "DEEP",
        conceptsDemonstrated: ["Sorted Sets", "SkipList"],
      },
      {
        turnNumber: 8,
        topic: "REDIS",
        concept: "Cluster architecture",
        question: "How does Redis Cluster handle multi-key operations?",
        candidateAnswer: "Redis Cluster automatically distributes multi-key operations across all nodes with zero restrictions.",
        correctnessScore: 35,
        completenessScore: 30,
        depthLevel: "SHALLOW",
        conceptsDemonstrated: [],
        conceptsMissing: ["hash tags", "CROSSSLOT Keys"],
        misconceptions: ["Multi-key operations work across arbitrary nodes without hash tags"],
      },
    ];

    const state = interviewStateBuilderService.buildState(session, turns);

    // Topic mastery preserves evidence turns [3, 8]
    assert.deepEqual(state.topicMastery["REDIS"].evidenceTurns, [3, 8]);
    assert.equal(state.topicMastery["REDIS"].avgScore, 65);
    assert.equal(state.topicMastery["REDIS"].level, "INTERMEDIATE");

    // Misconception is retained
    assert.equal(state.misconceptions.length, 1);
    assert.equal(state.misconceptions[0].turn, 8);

    // Prompt contains both evidence turns and the misconception
    const promptText = interviewStateBuilderService.formatStateForPrompt(state);
    assert.ok(promptText.includes("turns: 3,8"));
    assert.ok(promptText.includes("Multi-key operations work across arbitrary nodes"));
  });

  test("recent turn answers are bounded and do not explode in size", () => {
    const session = { techStack: ["PostgreSQL"] };
    const longAnswer = "A".repeat(2000);
    const turns = [
      {
        turnNumber: 15,
        topic: "POSTGRESQL",
        question: "Explain MVCC.",
        candidateAnswer: longAnswer,
        correctnessScore: 80,
      },
    ];

    const state = interviewStateBuilderService.buildState(session, turns);
    assert.equal(state.recentTurns.length, 1);
    assert.ok(state.recentTurns[0].candidateAnswer.length <= 300);

    const promptText = interviewStateBuilderService.formatStateForPrompt(state);
    // Even with a 2000 character answer in the turn, formatted prompt is compact
    assert.ok(promptText.length < 1000);
  });
});
