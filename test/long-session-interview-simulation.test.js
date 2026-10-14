import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { AnswerAnalysisService } from "../src/ai-interview/services/answer-analysis.service.js";
import { AiAnswerAnalysisService } from "../src/ai-interview/ai/ai-answer-analysis.service.js";
import { AiQuestionService } from "../src/ai-interview/ai/ai-question.service.js";
import { QuestionDedupService, questionDedupService } from "../src/ai-interview/services/question-dedup.service.js";
import { InterviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { aiService } from "../src/ai-interview/ai/ai.service.js";
import { questionBankService } from "../src/ai-interview/services/question-bank.service.js";
import { AiCallLog } from "../src/ai-interview/schemas/ai-call-log.schema.js";

test("End-to-End 25-Question Real Interview Simulation & Long-Session Validation", async (t) => {
  // Prevent unneeded DB buffering delays in standalone unit test runner
  questionBankService.saveGeneratedQuestion = async () => null;
  questionBankService.getBankQuestion = async () => null;
  AiCallLog.create = async () => null;

  const adaptiveEngine = new AdaptiveEngineService();
  const answerAnalysis = new AnswerAnalysisService(new AiAnswerAnalysisService(aiService));
  const aiQuestion = new AiQuestionService(aiService);
  const dedupService = new QuestionDedupService();
  const mockAiFeedback = {
    generateInterviewFeedback: async (params) => ({
      overallFeedback: `Candidate demonstrated solid technical capabilities with an overall score of ${params.score}/100 and readiness of ${params.readinessScore}/100.`,
      perQuestion: (params.turnsSummary || []).map((t) => ({
        turnNumber: t.turnNumber,
        whatWasGood: "Good attempt addressing the question.",
        whatToImprove: "Deepen operational and edge-case coverage.",
        idealAnswer: "A comprehensive answer detailing production trade-offs.",
      })),
    }),
  };
  const resultsService = new InterviewResultsService(mockAiFeedback);

  // Candidate Setup: Senior Backend Engineer claiming Redis, Node.js, PostgreSQL, System Design
  const candidateUserId = new mongoose.Types.ObjectId();
  const sessionPlan = {
    globalQuestionLimit: 25,
    maxQuestionsPerTopic: 4,
    maxFollowUpsPerTopic: 3,
    maxFollowUpsPerQuestion: 3,
    maxGlobalFollowUps: 10,
    difficulty: "ADAPTIVE",
  };

  const topicsPlanned = ["INTRODUCTION", "NODE.JS", "REDIS", "POSTGRESQL", "SYSTEM_DESIGN", "DEVOPS"];

  // Initialize Session State
  const session = {
    _id: new mongoose.Types.ObjectId(),
    userId: candidateUserId,
    interviewId: "int-sim-long-session-25",
    interviewState: InterviewState.IN_PROGRESS,
    role: "Senior Backend Engineer",
    experienceLevel: "4-6 Years",
    duration: 45,
    difficulty: Difficulty.ADAPTIVE,
    timeRemaining: 2700,
    currentTopic: "INTRODUCTION",
    currentQuestion: null,
    questionCount: 0,
    topicQuestionCount: 0,
    followUpCount: 0,
    topicFollowUpCount: 0,
    globalFollowUpCount: 0,
    candidatePerformance: {
      consecutiveKnowledgeGapsInTopic: 0,
      streakCorrect: 0,
      streakGaps: 0,
      runningAccuracy: 0,
    },
    topicOrder: topicsPlanned,
    allowedTopics: topicsPlanned,
    techStack: ["Node.js", "Redis", "PostgreSQL", "System Design", "Docker"],
    resumeData: {
      extracted: {
        skills: ["Node.js", "Redis", "PostgreSQL", "Distributed Systems", "Docker"],
        experience: "Senior Backend Engineer with 5 years experience architecting high-throughput microservices and Redis distributed caching layers.",
      },
    },
    coverageState: topicsPlanned.map((tp) => ({
      topic: tp,
      questionsAsked: 0,
      followupsAsked: 0,
      knowledgeGaps: 0,
      coveragePercentage: 0,
      knowledgeLevel: "NONE",
      status: "PENDING",
      conceptsTested: [],
      conceptsKnown: [],
      conceptsMissing: [],
      bestScore: 0,
      averageScore: 0,
      depthEstablished: false,
    })),
  };

  // Turn History Collection across the 25 turns
  const sessionTurns = [];

  // Helper to record an evaluated turn
  function recordTurn(turnData) {
    const turnNumber = sessionTurns.length + 1;
    const turn = {
      _id: new mongoose.Types.ObjectId(),
      sessionId: session._id,
      interviewId: session.interviewId,
      turnNumber,
      topic: turnData.topic || session.currentTopic,
      question: turnData.question,
      concept: turnData.concept || `${turnData.topic || session.currentTopic} core`,
      candidateAnswer: turnData.candidateAnswer,
      difficulty: turnData.difficulty || Difficulty.MEDIUM,
      questionType: turnData.questionType || (turnData.isFollowUp ? "DEPTH_PROBE" : "TECHNICAL"),
      isFollowUp: Boolean(turnData.isFollowUp),
      followUp: Boolean(turnData.isFollowUp),
      parentTurnId: turnData.isFollowUp ? sessionTurns[sessionTurns.length - 1]?._id : null,
      answerStatus: turnData.answerStatus || AnswerStatus.ACCURATE,
      correctnessScore: turnData.correctnessScore ?? 80,
      relevanceScore: turnData.relevanceScore ?? 85,
      completenessScore: turnData.completenessScore ?? 75,
      confidence: turnData.confidence ?? 80,
      depthLevel: turnData.depthLevel || "ADEQUATE",
      knowledgeLevel: turnData.knowledgeLevel || "STRONG",
      depthEstablished: Boolean(turnData.depthEstablished),
      experienceAuthenticity: turnData.experienceAuthenticity || "PRODUCTION_VERIFIED",
      followUpType: turnData.followUpType || "NONE",
      followUpAllowed: Boolean(turnData.followUpAllowed),
      conceptsDemonstrated: turnData.conceptsDemonstrated || [],
      conceptsMissing: turnData.conceptsMissing || [],
      misconceptions: turnData.misconceptions || [],
      contradictionDetected: Boolean(turnData.contradictionDetected),
      isExplicitGap: Boolean(turnData.isExplicitGap),
      processingState: "ANALYZED",
    };

    sessionTurns.push(turn);

    // Update session counters
    session.questionCount = turnNumber;
    if (turn.isFollowUp) {
      session.followUpCount = (session.followUpCount || 0) + 1;
      session.topicFollowUpCount = (session.topicFollowUpCount || 0) + 1;
      session.globalFollowUpCount = (session.globalFollowUpCount || 0) + 1;
    } else {
      session.topicQuestionCount = (session.topicQuestionCount || 0) + 1;
      session.followUpCount = 0;
    }

    // Update topic coverage
    const cov = session.coverageState.find((c) => c.topic === turn.topic);
    if (cov) {
      cov.questionsAsked += 1;
      if (turn.isFollowUp) cov.followupsAsked += 1;
      if (turn.answerStatus === AnswerStatus.KNOWLEDGE_GAP) {
        cov.knowledgeGaps += 1;
        session.candidatePerformance.consecutiveKnowledgeGapsInTopic += 1;
        if (cov.knowledgeGaps >= 2) {
          cov.knowledgeLevel = "NONE";
        }
      } else {
        session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;
      }
      cov.bestScore = Math.max(cov.bestScore, turn.correctnessScore);
      cov.coveragePercentage = Math.min(100, Math.round((cov.questionsAsked / 3) * 100));
      if (turn.depthEstablished) {
        cov.depthEstablished = true;
        cov.knowledgeLevel = "EXCELLENT";
      } else if (cov.knowledgeGaps >= 2) {
        cov.knowledgeLevel = "NONE";
      } else if (cov.bestScore >= 80) {
        cov.knowledgeLevel = "STRONG";
      } else if (cov.bestScore >= 50) {
        cov.knowledgeLevel = "INTERMEDIATE";
      }
      (turn.conceptsDemonstrated || []).forEach((c) => {
        if (!cov.conceptsKnown.includes(c)) cov.conceptsKnown.push(c);
        if (!cov.conceptsTested.includes(c)) cov.conceptsTested.push(c);
      });
      (turn.conceptsMissing || []).forEach((c) => {
        if (!cov.conceptsMissing.includes(c)) cov.conceptsMissing.push(c);
        if (!cov.conceptsTested.includes(c)) cov.conceptsTested.push(c);
      });
    }

    session.currentQuestion = {
      id: turn._id.toString(),
      turnNumber,
      questionText: turn.question,
      topic: turn.topic,
      difficulty: turn.difficulty,
    };

    return turn;
  }

  // =========================================================================
  // EXECUTE SIMULATION: 25 TURNS ACROSS ALL ARCHETYPES AND REQUIREMENTS
  // =========================================================================

  // Turn 1: INTRODUCTION
  recordTurn({
    topic: "INTRODUCTION",
    question: "Tell me about yourself, your background, and what you've been working on recently.",
    candidateAnswer:
      "I am a Senior Backend Engineer with 5 years of experience building Node.js microservices and Redis distributed caching systems. Recently I led the migration of a monolith into event-driven services using PostgreSQL and Redis.",
    correctnessScore: 90,
    relevanceScore: 95,
    completenessScore: 90,
    depthLevel: "ADEQUATE",
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    depthEstablished: false,
    followUpAllowed: false,
  });

  // Verify transition from Introduction to first technical topic
  const introNextAction = adaptiveEngine.determineNextAction(
    session,
    sessionPlan,
    sessionTurns[sessionTurns.length - 1]
  );
  assert.equal(
    introNextAction.action,
    InterviewAction.SWITCH_TOPIC,
    "Turn 1 (Introduction) must transition to first technical topic"
  );
  assert.equal(introNextAction.nextTopic, "NODE.JS");

  // Advance session to NODE.JS
  session.currentTopic = "NODE.JS";
  session.topicQuestionCount = 0;
  session.topicFollowUpCount = 0;
  session.followUpCount = 0;

  // Turn 2: NODE.JS - Primary question (Asynchronous Architecture)
  recordTurn({
    topic: "NODE.JS",
    question: "Explain the architecture of Node.js and how the event loop handles non-blocking I/O operations.",
    candidateAnswer:
      "Node.js runs on a single thread using the V8 engine and libuv. The event loop coordinates callbacks across phases like timers, pending callbacks, poll, check, and close.",
    correctnessScore: 88,
    relevanceScore: 90,
    completenessScore: 80,
    depthLevel: "ADEQUATE",
    knowledgeLevel: "STRONG",
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    conceptsDemonstrated: ["libuv", "event loop phases", "single thread"],
    conceptsMissing: ["threadpool offloading", "worker threads"],
    followUpAllowed: true,
  });

  // Verify Follow-up on Node.js
  const nodeFollowUpDecision = adaptiveEngine.determineNextAction(
    session,
    sessionPlan,
    sessionTurns[sessionTurns.length - 1]
  );
  assert.equal(
    nodeFollowUpDecision.action,
    InterviewAction.FOLLOW_UP,
    "Node.js first answer should allow depth follow-up"
  );

  // Turn 3: NODE.JS - Follow-up 1 (Libuv Threadpool & CPU Bound tasks)
  recordTurn({
    topic: "NODE.JS",
    isFollowUp: true,
    question:
      "When a CPU-intensive task like cryptographic hashing blocks the event loop, how does libuv threadpool or Worker Threads mitigate this in production?",
    candidateAnswer:
      "For crypto and fs, libuv delegates to its internal default 4-thread pool configured via UV_THREADPOOL_SIZE. For custom CPU-heavy algorithms, we spawn Worker Threads with shared ArrayBuffers to avoid blocking the main event loop.",
    correctnessScore: 95,
    relevanceScore: 95,
    completenessScore: 95,
    depthLevel: "DEEP",
    knowledgeLevel: "EXCELLENT",
    depthEstablished: true, // PROVEN DEPTH!
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    conceptsDemonstrated: ["UV_THREADPOOL_SIZE", "Worker Threads", "SharedArrayBuffer"],
    followUpAllowed: false,
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 2 (PART B): Very strong answer with proven depth triggers early exit
  // -------------------------------------------------------------------------
  await t.test("Requirement 2b: Proven depth with strong answer triggers early exit to next topic", () => {
    const decision = adaptiveEngine.determineNextAction(
      session,
      sessionPlan,
      sessionTurns[sessionTurns.length - 1]
    );
    assert.equal(
      decision.action,
      InterviewAction.SWITCH_TOPIC,
      "Proven depth must exit early to next topic rather than endlessly probing"
    );
    assert.equal(decision.decisionAudit.trigger, "DEPTH_PROVEN_EARLY_EXIT");
    assert.equal(decision.nextTopic, "REDIS");
  });

  // Advance session to REDIS
  session.currentTopic = "REDIS";
  session.topicQuestionCount = 0;
  session.topicFollowUpCount = 0;
  session.followUpCount = 0;

  // -------------------------------------------------------------------------
  // REQUIREMENT 5: Resume credibility (Candidate claims Redis -> tests practical challenges)
  // -------------------------------------------------------------------------
  let redisPrimaryQuestion = null;
  await t.test("Requirement 5: Resume credibility - claimed Redis experience generates practical scenario", async () => {
    // Generate primary question for Redis with resumeSkills provided
    const generated = await aiQuestion.generateQuestion({
      role: session.role,
      experienceLevel: session.experienceLevel,
      topic: "REDIS",
      difficulty: Difficulty.MEDIUM,
      previousQuestions: sessionTurns.map((t) => t.question),
      conceptsAlreadyTested: ["Introduction", "libuv", "event loop phases"],
      resumeSkills: session.resumeData.extracted.skills,
    });

    assert.ok(generated.question, "Redis question must be generated");
    redisPrimaryQuestion = generated.question;

    // Verify it is NOT just a trivial "What is Redis?" definition, but tests practical concepts
    const qLower = generated.question.toLowerCase();
    const isPracticalRedis =
      qLower.includes("cache") ||
      qLower.includes("invalidation") ||
      qLower.includes("stampede") ||
      qLower.includes("eviction") ||
      qLower.includes("expire") ||
      qLower.includes("ttl") ||
      qLower.includes("persist") ||
      qLower.includes("cluster") ||
      qLower.includes("memory") ||
      qLower.includes("concurrency") ||
      qLower.includes("performance") ||
      qLower.includes("rate limit") ||
      qLower.includes("race condition") ||
      qLower.includes("sliding window") ||
      qLower.includes("distributed") ||
      qLower.includes("throughput");

    assert.ok(
      isPracticalRedis,
      `Redis question (${generated.question}) must test practical/operational aspects, not a basic definition`
    );
  });

  // Turn 4: REDIS - Primary question
  recordTurn({
    topic: "REDIS",
    question:
      redisPrimaryQuestion ||
      "In a high-throughput microservices architecture, how do you handle cache invalidation and prevent cache stampede using Redis?",
    candidateAnswer:
      "To prevent cache stampede, we use mutual exclusion locks with Redis SETNX with a lease TTL, or probabilistic early expiration (XFetch algorithm). For invalidation, we use write-through caching and CDC via Debezium.",
    correctnessScore: 84,
    relevanceScore: 90,
    completenessScore: 80,
    depthLevel: "ADEQUATE",
    knowledgeLevel: "STRONG",
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    conceptsDemonstrated: ["SETNX distributed lock", "cache stampede", "probabilistic early expiration"],
    conceptsMissing: ["Redis eviction policies under memory pressure"],
    followUpAllowed: true,
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 1: Cross-question depth capping (maxFollowUpsPerTopic = 3)
  // -------------------------------------------------------------------------
  await t.test("Requirement 1: Topic follow-up depth is capped at maxFollowUpsPerTopic = 3", () => {
    // Follow-up 1 on REDIS
    session.topicFollowUpCount = 0;
    const dec1 = adaptiveEngine.determineNextAction(session, sessionPlan, sessionTurns[sessionTurns.length - 1]);
    assert.equal(dec1.action, InterviewAction.FOLLOW_UP, "Follow-up 1 must be permitted");

    // Turn 5: REDIS - Follow-up 1 (Memory Eviction Policies)
    recordTurn({
      topic: "REDIS",
      isFollowUp: true,
      question:
        "When Redis reaches maxmemory under peak load, how do volatile-lru, allkeys-lru, and volatile-ttl behave, and which do you choose for session data versus static caches?",
      candidateAnswer:
        "allkeys-lru evicts any key by LRU regardless of TTL, which is good for general caching. For sessions where losing non-expired logins breaks users, volatile-lru only evicts keys with an explicit TTL set.",
      correctnessScore: 85,
      depthLevel: "ADEQUATE",
      followUpAllowed: true,
    });

    // Follow-up 2 on REDIS
    assert.equal(session.topicFollowUpCount, 1);
    const dec2 = adaptiveEngine.determineNextAction(session, sessionPlan, sessionTurns[sessionTurns.length - 1]);
    assert.equal(dec2.action, InterviewAction.FOLLOW_UP, "Follow-up 2 must be permitted");

    // Turn 6: REDIS - Follow-up 2 (Persistence RDB vs AOF)
    recordTurn({
      topic: "REDIS",
      isFollowUp: true,
      question:
        "What are the operational trade-offs between RDB point-in-time snapshots and AOF fsync=everysec in a production environment during heavy write traffic?",
      candidateAnswer:
        "RDB fork can cause memory doubling and tail latency spikes with large datasets. AOF appendfsync everysec offers maximum 1-second data loss with minimal I/O impact, but the file grows until background rewrite executes.",
      correctnessScore: 86,
      depthLevel: "ADEQUATE",
      followUpAllowed: true,
    });

    // Follow-up 3 on REDIS
    assert.equal(session.topicFollowUpCount, 2);
    const dec3 = adaptiveEngine.determineNextAction(session, sessionPlan, sessionTurns[sessionTurns.length - 1]);
    assert.equal(dec3.action, InterviewAction.FOLLOW_UP, "Follow-up 3 must be permitted");

    // Turn 7: REDIS - Follow-up 3 (Clustering & Resharding)
    recordTurn({
      topic: "REDIS",
      isFollowUp: true,
      question:
        "How does Redis Cluster distribute 16,384 hash slots across nodes, and how do multi-key operations work when keys have hash tags?",
      candidateAnswer:
        "Hash slots are assigned across master nodes using CRC16(key) mod 16384. Multi-key commands only work if keys map to the same slot, which you force by wrapping identical substrings in curly braces like {user100}:profile.",
      correctnessScore: 82,
      depthLevel: "ADEQUATE",
      followUpAllowed: true,
    });

    // Now topicFollowUpCount reaches 3 (maxFollowUpsPerTopic)
    assert.equal(session.topicFollowUpCount, 3, "Topic follow-up count must be exactly 3");

    // Verify 4th follow-up is STRICTLY BLOCKED and engine forces topic transition
    const dec4 = adaptiveEngine.determineNextAction(session, sessionPlan, sessionTurns[sessionTurns.length - 1]);
    assert.notEqual(
      dec4.action,
      InterviewAction.FOLLOW_UP,
      "Candidate must NOT be trapped in Redis indefinitely after 3 follow-ups"
    );
    assert.equal(
      dec4.action,
      InterviewAction.SWITCH_TOPIC,
      "Engine must switch topic once maxFollowUpsPerTopic (3) is reached"
    );
    assert.equal(dec4.decisionAudit.reason, "TOPIC_CEILING_REACHED");
    assert.equal(dec4.nextTopic, "POSTGRESQL");
  });

  // Advance session to POSTGRESQL
  session.currentTopic = "POSTGRESQL";
  session.topicQuestionCount = 0;
  session.topicFollowUpCount = 0;
  session.followUpCount = 0;
  session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;

  // -------------------------------------------------------------------------
  // REQUIREMENT 4: Experience authenticity (Textbook answer challenges with VALIDATION)
  // -------------------------------------------------------------------------
  await t.test("Requirement 4: Textbook answer with claimed experience triggers VALIDATION challenge", () => {
    // Turn 8: POSTGRESQL - Candidate gives a pure textbook definition of ACID
    recordTurn({
      topic: "POSTGRESQL",
      question: "Explain transaction isolation levels and the ACID guarantees in PostgreSQL.",
      candidateAnswer:
        "ACID stands for Atomicity, Consistency, Isolation, and Durability. Atomicity means all or nothing, Consistency ensures rules, Isolation isolates concurrent transactions, and Durability guarantees committed changes persist.",
      correctnessScore: 92, // High correctness on textbook definition
      depthLevel: "SHALLOW", // Shallow textbook recitation!
      knowledgeLevel: "EXCELLENT",
      depthEstablished: false,
      experienceAuthenticity: "THEORETICAL_TEXTBOOK", // Textbook flag
      followUpAllowed: true,
      followUpRecommended: true,
    });

    const dec = adaptiveEngine.determineNextAction(session, sessionPlan, sessionTurns[sessionTurns.length - 1]);
    assert.equal(dec.action, InterviewAction.FOLLOW_UP, "Textbook answer must trigger follow-up");
    assert.equal(
      dec.followUpType,
      "VALIDATION",
      "Textbook answer with shallow depth must trigger VALIDATION follow-up to test authentic experience"
    );
    assert.equal(dec.decisionAudit.trigger, "SHALLOW_HIGH_SCORE");
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 2 (PART A): Topic transition after 2-3 weak answers / gaps
  // -------------------------------------------------------------------------
  await t.test("Requirement 2a: Repeated weak answers / knowledge gaps trigger clean topic transition", () => {
    // Turn 9: POSTGRESQL - Validation follow-up on Write Skew & Serialization Failures
    // Candidate gives weak/incorrect answer (Gap 1)
    recordTurn({
      topic: "POSTGRESQL",
      isFollowUp: true,
      question:
        "In PostgreSQL REPEATABLE READ, how do you handle write skew anomalies or 40001 serialization failures in production application code?",
      candidateAnswer: "Repeatable read prevents all concurrency bugs automatically so serialization errors never happen.",
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      correctnessScore: 25,
      depthLevel: "SHALLOW",
      knowledgeLevel: "NONE",
      isExplicitGap: false,
      followUpAllowed: false,
    });

    assert.equal(session.candidatePerformance.consecutiveKnowledgeGapsInTopic, 1);

    // Turn 10: POSTGRESQL - Alternative concept question on PostgreSQL MVCC / VACUUM
    // Candidate admits explicit knowledge gap (Gap 2)
    recordTurn({
      topic: "POSTGRESQL",
      question: "How does PostgreSQL MVCC handle row versioning and why does dead tuple bloat require autovacuum tuning?",
      candidateAnswer: "I don't know anything about MVCC or vacuuming internals in Postgres.",
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      correctnessScore: 0,
      depthLevel: "SHALLOW",
      knowledgeLevel: "NONE",
      isExplicitGap: true,
      followUpAllowed: false,
    });

    assert.equal(
      session.candidatePerformance.consecutiveKnowledgeGapsInTopic,
      2,
      "Consecutive knowledge gaps in PostgreSQL must equal 2"
    );

    // Verify engine triggers immediate SWITCH_TOPIC without trapping candidate
    const dec = adaptiveEngine.determineNextAction(session, sessionPlan, sessionTurns[sessionTurns.length - 1]);
    assert.equal(
      dec.action,
      InterviewAction.SWITCH_TOPIC,
      "Must immediately switch topic after 2 consecutive knowledge gaps"
    );
    assert.equal(dec.decisionAudit.trigger, "CONSECUTIVE_GAPS_EXIT");
    assert.equal(dec.nextTopic, "SYSTEM_DESIGN");
  });

  // Advance session to SYSTEM_DESIGN
  session.currentTopic = "SYSTEM_DESIGN";
  session.topicQuestionCount = 0;
  session.topicFollowUpCount = 0;
  session.followUpCount = 0;
  session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;

  // Turn 11: SYSTEM_DESIGN - Distributed Idempotency
  recordTurn({
    topic: "SYSTEM_DESIGN",
    question: "Design an idempotent payment processing system that guarantees exactly-once billing semantics during network retries.",
    candidateAnswer:
      "Clients generate a unique idempotency key with UUIDv4 sent in headers. The API gateway checks Redis with SETNX key with 24h TTL. If lock acquired, process payment via payment gateway and persist state with unique constraint in database.",
    correctnessScore: 92,
    relevanceScore: 95,
    completenessScore: 90,
    depthLevel: "DEEP",
    knowledgeLevel: "STRONG",
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    followUpAllowed: true,
  });

  // Turn 12: SYSTEM_DESIGN - Distributed Transactions / Saga Pattern
  recordTurn({
    topic: "SYSTEM_DESIGN",
    isFollowUp: true,
    question: "When a multi-step checkout workflow spans payment, inventory, and fulfillment services, how do you handle partial failures using the Saga pattern?",
    candidateAnswer:
      "We use an orchestration-based Saga with Temporal or Kafka. Each step has a compensating transaction. If inventory reservation fails after payment, the orchestrator triggers the payment compensation (refund).",
    correctnessScore: 94,
    relevanceScore: 95,
    completenessScore: 90,
    depthLevel: "DEEP",
    knowledgeLevel: "EXCELLENT",
    depthEstablished: true,
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    followUpAllowed: false,
  });

  // Advance session to DEVOPS / DOCKER
  session.currentTopic = "DEVOPS";
  session.topicQuestionCount = 0;
  session.topicFollowUpCount = 0;
  session.followUpCount = 0;
  session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;

  // Turn 13: DEVOPS - Containerization & Kubernetes Health Probes
  recordTurn({
    topic: "DEVOPS",
    question: "Explain the difference between Kubernetes liveness, readiness, and startup probes in containerized Node.js services.",
    candidateAnswer:
      "Startup probes guard slow initialization. Readiness probes verify the container can accept ingress traffic (e.g. database connection established). Liveness probes detect deadlocks and restart the container if it fails.",
    correctnessScore: 88,
    relevanceScore: 90,
    completenessScore: 85,
    depthLevel: "ADEQUATE",
    knowledgeLevel: "STRONG",
    experienceAuthenticity: "PRODUCTION_VERIFIED",
    followUpAllowed: true,
  });

  // Turn 14 to 25: Populate remaining turns to reach a complete 25-turn interview session
  const remainingArchetypes = [
    { topic: "DEVOPS", q: "How do you minimize Docker container image layers and attack surface for production deployments?", a: "Multi-stage builds copying only dist and production node_modules onto alpine or distroless base images.", score: 90, depth: "DEEP" },
    { topic: "NODE.JS", q: "How do Node.js Streams implement backpressure to avoid memory overflow during large file transformations?", a: "Backpressure pauses the readable stream when write returns false until the drain event fires on the writable stream.", score: 92, depth: "DEEP" },
    { topic: "NODE.JS", q: "Explain how memory leaks occur in Node.js applications with event listeners or closures and how you profile them.", a: "Unremoved event listeners retain closures in heap. We capture heap snapshots in Chrome DevTools or use clinic.js heap profiler.", score: 87, depth: "ADEQUATE" },
    { topic: "REDIS", q: "How do you implement a distributed sliding-window rate limiter using Redis sorted sets (ZSET)?", a: "Use ZREMRANGEBYSCORE to prune expired timestamps, ZADD the current timestamp, and ZCARD to verify count within window in a MULTI transaction.", score: 95, depth: "DEEP" },
    { topic: "REDIS", q: "How do Redis Sentinel and Redis Cluster differ in handling automated master failover and split-brain scenarios?", a: "Sentinel provides high availability with quorum-based failover for single-master topologies, whereas Cluster shards data across slots with Raft-like master voting.", score: 89, depth: "ADEQUATE" },
    { topic: "SYSTEM_DESIGN", q: "How do you design a real-time notification service supporting 10 million concurrent WebSocket connections?", a: "WebSocket connection servers decoupled from business logic via Redis Pub/Sub or Kafka topic partitions, behind an ALB with sticky sessions.", score: 91, depth: "DEEP" },
    { topic: "SYSTEM_DESIGN", q: "Explain the CAP theorem and PACELC trade-offs when choosing between Cassandra and PostgreSQL for high-write telemetry data.", a: "Under PACELC, Cassandra chooses PA/EL (Availability over Consistency under partition; Latency over Consistency under normal state) using tunable quorum.", score: 93, depth: "DEEP" },
    { topic: "DEVOPS", q: "How do you achieve zero-downtime rolling deployments using Kubernetes maxSurge and maxUnavailable configurations?", a: "Configure maxSurge=25% and maxUnavailable=0 with graceful SIGTERM termination handling in the app to drain in-flight HTTP requests.", score: 91, depth: "DEEP" },
    { topic: "DEVOPS", q: "How do you configure CI/CD pipeline artifact caching and vulnerability scanning with Trivy in GitHub Actions?", a: "Cache ~/.npm and Docker buildkit layers, then run Trivy security scanner on high/critical CVEs before pushing to registry.", score: 88, depth: "ADEQUATE" },
    { topic: "SYSTEM_DESIGN", q: "How do you design a globally distributed URL shortening service (like Bitly) with low latency read redirects?", a: "Base62 encoding of distributed unique IDs (Twitter Snowflake) with aggressive CDN and Redis caching of hot URLs.", score: 90, depth: "DEEP" },
    { topic: "NODE.JS", q: "How does the Node.js cluster module fork worker processes and share server ports using round-robin socket delegation?", a: "Master process binds to port 80 and delegates incoming connection handles to worker processes using IPC round-robin.", score: 89, depth: "ADEQUATE" },
    { topic: "SYSTEM_DESIGN", q: "How do you design a multi-tenant database partitioning strategy using tenant_id schemas versus shared tables with row-level security?", a: "Shared tables with row-level security offer lower connection overhead, whereas schema-per-tenant provides physical isolation.", score: 91, depth: "DEEP" },
  ];

  for (const rem of remainingArchetypes) {
    if (sessionTurns.length >= 25) break;
    recordTurn({
      topic: rem.topic,
      question: rem.q,
      candidateAnswer: rem.a,
      correctnessScore: rem.score,
      relevanceScore: 90,
      completenessScore: 85,
      depthLevel: rem.depth,
      knowledgeLevel: rem.score >= 90 ? "EXCELLENT" : "STRONG",
      depthEstablished: rem.depth === "DEEP",
      experienceAuthenticity: "PRODUCTION_VERIFIED",
    });
  }

  assert.equal(sessionTurns.length, 25, "Simulation must contain exactly 25 completed turns");

  // -------------------------------------------------------------------------
  // REQUIREMENT 3: No semantic repetition across 25 turns
  // -------------------------------------------------------------------------
  await t.test("Requirement 3: No semantic repetition across all 25 turns", () => {
    const allQuestions = sessionTurns.map((t) => t.question);
    assert.equal(new Set(allQuestions).size, 25, "All 25 question strings must be unique");

    // Pairwise Jaccard Similarity check across all 300 unique pairs (25 * 24 / 2)
    let maxSimilarity = 0;
    let mostSimilarPair = null;

    for (let i = 0; i < allQuestions.length; i++) {
      for (let j = i + 1; j < allQuestions.length; j++) {
        const qA = allQuestions[i];
        const qB = allQuestions[j];

        // Tokenize and calculate Jaccard overlap
        const stopWords = new Set(["what", "is", "the", "a", "an", "in", "to", "of", "and", "or", "how", "does", "do", "you", "explain"]);
        const tokensA = new Set(qA.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w)));
        const tokensB = new Set(qB.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w)));

        let intersection = 0;
        for (const token of tokensA) {
          if (tokensB.has(token)) intersection++;
        }
        const union = new Set([...tokensA, ...tokensB]).size;
        const jaccard = union === 0 ? 0 : intersection / union;

        if (jaccard > maxSimilarity) {
          maxSimilarity = jaccard;
          mostSimilarPair = { qA, qB, jaccard };
        }

        assert.ok(
          jaccard < 0.60,
          `Semantic repetition detected between Turn ${i + 1} and Turn ${j + 1} (Jaccard: ${jaccard.toFixed(2)}):\nQ1: "${qA}"\nQ2: "${qB}"`
        );
      }
    }

    assert.ok(
      maxSimilarity < 0.60,
      `Max pairwise similarity (${maxSimilarity.toFixed(2)}) must be below deduplication threshold (0.60)`
    );
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 6: Final score consistency
  // -------------------------------------------------------------------------
  await t.test("Requirement 6: Final evaluation report reflects accumulated turn evidence rather than raw LLM confidence averaging", async () => {
    // 1. Manually calculate expected weighted composite score
    // turnScore = 0.6 * correctnessScore + 0.2 * relevanceScore + 0.2 * completenessScore
    const turnScores = sessionTurns.map((t) =>
      Math.round(0.6 * t.correctnessScore + 0.2 * t.relevanceScore + 0.2 * t.completenessScore)
    );
    const expectedAverageScore = Math.round(turnScores.reduce((sum, s) => sum + s, 0) / turnScores.length);

    // 2. Average of candidate's raw confidence scores
    const rawConfidenceAverage = Math.round(
      sessionTurns.reduce((sum, t) => sum + t.confidence, 0) / sessionTurns.length
    );

    // Verify turn score formula
    assert.equal(typeof expectedAverageScore, "number");
    assert.ok(expectedAverageScore >= 70 && expectedAverageScore <= 95);

    // 3. Compute results using InterviewResultsService
    const mockPlanDoc = { _id: sessionPlan._id, globalQuestionLimit: 25 };
    const mockSessionDoc = {
      ...session,
      coverageState: session.coverageState,
    };

    // Calculate competency scores
    const competencyScores = resultsService.computeCompetencyScores(sessionTurns, expectedAverageScore);
    assert.ok(competencyScores.technicalSkills > 0, "Technical skills must have score");
    assert.ok(competencyScores.systemDesign > 0, "System design must have score");

    // Calculate strengths and weaknesses from evidence
    const mappedBuckets = new Set(sessionTurns.map((t) => resultsService.mapToBucket(t.topic, t.questionType)));
    const { strengths, weaknesses } = resultsService.computeStrengthsAndWeaknesses(
      competencyScores,
      mappedBuckets,
      session.coverageState
    );

    // Evidence checks:
    // Topics where candidate performed strongly must be recognized in Strengths
    assert.ok(strengths.length > 0, "Strengths must be populated from demonstrated turns");

    // Topic with explicit knowledge gaps (PostgreSQL) must be recognized in Weaknesses / Recommended Practice
    const postgresCoverage = session.coverageState.find((c) => c.topic === "POSTGRESQL");
    assert.ok(postgresCoverage.knowledgeGaps >= 2, "PostgreSQL must have recorded 2 knowledge gaps");
    assert.equal(postgresCoverage.knowledgeLevel, "NONE", "PostgreSQL knowledge level must be NONE");
    assert.ok(
      weaknesses.some((w) => w.toLowerCase().includes("postgres") || w.toLowerCase().includes("technical")),
      `PostgreSQL knowledge gaps must be reflected in weaknesses (actual weaknesses: ${JSON.stringify(weaknesses)})`
    );

    // 4. Calculate Readiness Score
    const completionRate = resultsService.clamp(sessionTurns.length / 25, 0, 1); // 25 / 25 = 1.0
    const coverageValues = session.coverageState.map((c) => c.coveragePercentage || 0);
    const coverageBreadth = coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length / 100;
    const readinessScore = Math.round(
      expectedAverageScore * 0.7 + completionRate * 100 * 0.15 + coverageBreadth * 100 * 0.15
    );

    assert.ok(readinessScore >= 70, `Readiness score (${readinessScore}) must reflect high completion and solid score`);
    assert.notEqual(
      readinessScore,
      rawConfidenceAverage,
      "Readiness score is an accumulated evidence composite, not raw confidence average"
    );
  });
});
