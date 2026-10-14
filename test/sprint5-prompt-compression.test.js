import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { interviewStateBuilderService } from "../src/ai-interview/services/interview-state-builder.service.js";
import { aiAnswerAnalysisService } from "../src/ai-interview/ai/ai-answer-analysis.service.js";

describe("Sprint 5: Prompt Compression & Evaluator Equivalence", () => {
  const session = {
    role: "Senior Backend Engineer",
    experienceLevel: "5+ Years",
    resumeData: {
      extracted: { skills: ["Node.js", "PostgreSQL", "Redis"] },
    },
    techStack: ["Node.js", "PostgreSQL", "Redis"],
    currentTopic: "REDIS",
    difficulty: "MEDIUM",
  };

  // Build a 10-turn history simulating a progressive technical interview
  const tenPastTurns = [
    {
      turnNumber: 1,
      topic: "NODE.JS",
      question: "Explain the libuv event loop phases.",
      candidateAnswer: "The event loop has timers, I/O callbacks, idle/prepare, poll, check, and close phases. Microtasks drain between phases.",
      correctnessScore: 92,
      completenessScore: 88,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["Event Loop", "libuv", "Microtasks"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 2,
      topic: "NODE.JS",
      question: "How do Node streams handle backpressure?",
      candidateAnswer: "Writable.write() returns false when highWaterMark is exceeded, pausing readable until drain event fires.",
      correctnessScore: 90,
      completenessScore: 85,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["Streams", "Backpressure", "highWaterMark"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 3,
      topic: "NODE.JS",
      question: "When should you use worker threads?",
      candidateAnswer: "Worker threads run CPU intensive tasks using SharedArrayBuffer without blocking the event loop.",
      correctnessScore: 85,
      completenessScore: 80,
      depthLevel: "ADEQUATE",
      conceptsDemonstrated: ["Worker Threads", "SharedArrayBuffer"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 4,
      topic: "POSTGRESQL",
      question: "Explain PostgreSQL MVCC and tuple visibility.",
      candidateAnswer: "PostgreSQL uses xmin and xmax transaction IDs on tuples to present snapshots to readers without read locks.",
      correctnessScore: 90,
      completenessScore: 88,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["MVCC", "xmin", "xmax"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 5,
      topic: "POSTGRESQL",
      question: "How do composite indexes work?",
      candidateAnswer: "Composite indexes follow the leftmost column rule. They also incur write overhead on INSERT and UPDATE operations.",
      correctnessScore: 88,
      completenessScore: 82,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["Composite Index", "Leftmost Rule"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 6,
      topic: "POSTGRESQL",
      question: "Explain PostgreSQL isolation levels.",
      candidateAnswer: "Read committed, repeatable read, and serializable. Serializable uses SSI to prevent write skew.",
      correctnessScore: 92,
      completenessScore: 90,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["Isolation Levels", "SSI", "Serializable"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 7,
      topic: "REDIS",
      question: "Compare Redis RDB vs AOF persistence.",
      candidateAnswer: "RDB uses fork and COW for snapshots; AOF logs writes with fsync policies like always and everysec.",
      correctnessScore: 90,
      completenessScore: 88,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["RDB", "AOF", "fsync policies"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 8,
      topic: "REDIS",
      question: "How do Redis sorted sets work internally?",
      candidateAnswer: "Sorted sets use a combination of a hash table and a skip list to achieve O(log N) lookups and insertions.",
      correctnessScore: 95,
      completenessScore: 92,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["Sorted Sets", "Skip List"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 9,
      topic: "REDIS",
      question: "Explain Redis eviction policies.",
      candidateAnswer: "Redis provides noeviction, allkeys-lru, volatile-lru, and LFU policies when maxmemory is hit.",
      correctnessScore: 88,
      completenessScore: 85,
      depthLevel: "DEEP",
      conceptsDemonstrated: ["Eviction Policies", "LRU", "LFU"],
      conceptsMissing: [],
      misconceptions: [],
    },
    {
      turnNumber: 10,
      topic: "REDIS",
      question: "What is Redis replication lag?",
      candidateAnswer: "Replication lag occurs when replicas fall behind the primary's replication backlog buffer.",
      correctnessScore: 85,
      completenessScore: 80,
      depthLevel: "ADEQUATE",
      conceptsDemonstrated: ["Replication Lag", "Replication Backlog"],
      conceptsMissing: [],
      misconceptions: [],
    },
  ];

  test("1. Prompt Size Stability: Compact prompt does not grow linearly with turns", () => {
    // Legacy full history prompt construction
    const legacyHistoryText = tenPastTurns
      .map((t, idx) => `[Turn ${idx + 1}] Q: "${t.question}" -> A: "${t.candidateAnswer}"`)
      .join("\n");

    // Sprint 5 compact interview state prompt construction
    const compactState = interviewStateBuilderService.buildState(session, tenPastTurns, {
      question: "How does Redis Sentinel achieve quorum?",
      topic: "REDIS",
      difficulty: "HARD",
    });
    const compactPromptText = interviewStateBuilderService.formatStateForPrompt(compactState);

    // Assert that legacy prompt is inflated
    assert.ok(legacyHistoryText.length > 1500, `Legacy text grows with each turn, got ${legacyHistoryText.length}`);

    // Assert that compact prompt is strictly bounded
    assert.ok(compactPromptText.length < 900, `Compact prompt should be compact, got ${compactPromptText.length}`);

    // Assert prompt character reduction ratio >= 45%
    const reductionRatio = (legacyHistoryText.length - compactPromptText.length) / legacyHistoryText.length;
    assert.ok(reductionRatio >= 0.45, `Prompt character reduction should be >= 45%, got ${Math.round(reductionRatio * 100)}%`);
  });

  test("2. Context Integrity: Compact state preserves all critical context fields", () => {
    const compactState = interviewStateBuilderService.buildState(session, tenPastTurns);

    // Tested concepts with provenance
    assert.ok(compactState.testedConcepts.length >= 10);
    assert.ok(compactState.testedConcepts.some((c) => c.concept === "Event Loop" && c.turn === 1));
    assert.ok(compactState.testedConcepts.some((c) => c.concept === "MVCC" && c.turn === 4));
    assert.ok(compactState.testedConcepts.some((c) => c.concept === "Skip List" && c.turn === 8));

    // Topic mastery with evidence turns
    assert.deepEqual(compactState.topicMastery["NODE.JS"].evidenceTurns, [1, 2, 3]);
    assert.deepEqual(compactState.topicMastery["POSTGRESQL"].evidenceTurns, [4, 5, 6]);
    assert.deepEqual(compactState.topicMastery["REDIS"].evidenceTurns, [7, 8, 9, 10]);
    assert.equal(compactState.topicMastery["NODE.JS"].level, "EXCELLENT");
    assert.equal(compactState.topicMastery["REDIS"].level, "EXCELLENT");

    // Resume claims validation
    const nodeClaim = compactState.resumeClaimsValidated.find((c) => c.claim === "Node.js");
    const pgClaim = compactState.resumeClaimsValidated.find((c) => c.claim === "PostgreSQL");
    const redisClaim = compactState.resumeClaimsValidated.find((c) => c.claim === "Redis");
    assert.equal(nodeClaim.status, "SUPPORTED");
    assert.equal(pgClaim.status, "SUPPORTED");
    assert.equal(redisClaim.status, "SUPPORTED");

    // Recent turns bounded to last 2
    assert.equal(compactState.recentTurns.length, 2);
    assert.equal(compactState.recentTurns[0].turnNumber, 9);
    assert.equal(compactState.recentTurns[1].turnNumber, 10);
  });

  test("3. Feature Flag: COMPACT_EVALUATOR_ENABLED=false toggles legacy formatting", async () => {
    let capturedUserPrompt = null;
    const mockLlm = {
      generateStructuredJson: async ({ userPrompt }) => {
        capturedUserPrompt = userPrompt;
        return {
          answerStatus: "ACCURATE",
          correctnessScore: 90,
          completenessScore: 85,
          depthLevel: "DEEP",
          knowledgeLevel: "EXCELLENT",
          followUpRecommended: false,
        };
      },
    };

    const analyzer = new (aiAnswerAnalysisService.constructor)(mockLlm);

    // Test with COMPACT_EVALUATOR_ENABLED = "false"
    process.env.COMPACT_EVALUATOR_ENABLED = "false";
    await analyzer.analyzeCandidateAnswer({
      question: "How does Redis Sentinel achieve quorum?",
      candidateAnswer: "Sentinels exchange heartbeat messages and require a quorum of votes to initiate failover.",
      topic: "REDIS",
      difficulty: "HARD",
      previousTurns: tenPastTurns,
    });

    assert.ok(capturedUserPrompt.includes("Previous Session Turns (check for contradictions):"));
    assert.ok(capturedUserPrompt.includes("[Turn 1]"));
    assert.ok(capturedUserPrompt.includes("[Turn 10]"));

    // Test with COMPACT_EVALUATOR_ENABLED = "true" (default)
    process.env.COMPACT_EVALUATOR_ENABLED = "true";
    await analyzer.analyzeCandidateAnswer({
      question: "How does Redis Sentinel achieve quorum?",
      candidateAnswer: "Sentinels exchange heartbeat messages and require a quorum of votes to initiate failover.",
      topic: "REDIS",
      difficulty: "HARD",
      previousTurns: tenPastTurns,
    });

    assert.ok(capturedUserPrompt.includes("Structured Interview Evidence:"));
    assert.ok(capturedUserPrompt.includes("• Verified Concepts:"));
    assert.ok(capturedUserPrompt.includes("• Topic Mastery:"));
    assert.ok(capturedUserPrompt.includes("Recent Context (last 1-2 turns):"));
    // Turn 1 transcript should NOT be in user prompt in compact mode
    assert.ok(!capturedUserPrompt.includes("[Turn 1] Q: \"Explain the libuv"));

    // Reset env
    delete process.env.COMPACT_EVALUATOR_ENABLED;
  });

  test("4. Contradiction Detection Context: Compact state presents known misconceptions to prompt", () => {
    const turnsWithMisconception = [
      ...tenPastTurns.slice(0, 5),
      {
        turnNumber: 6,
        topic: "POSTGRESQL",
        question: "Explain write locks in PostgreSQL.",
        candidateAnswer: "Indexes have zero overhead on write operations.",
        correctnessScore: 40,
        completenessScore: 30,
        depthLevel: "SHALLOW",
        conceptsDemonstrated: [],
        conceptsMissing: ["Write amplification"],
        misconceptions: ["Indexes have zero overhead on write operations"],
      },
    ];

    const compactState = interviewStateBuilderService.buildState(session, turnsWithMisconception);
    const promptText = interviewStateBuilderService.formatStateForPrompt(compactState);

    assert.ok(promptText.includes("Known Misconceptions:"));
    assert.ok(promptText.includes('"Indexes have zero overhead on write operations" on POSTGRESQL (T6)'));
  });
});
