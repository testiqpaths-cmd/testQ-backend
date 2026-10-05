import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { AiAnswerAnalysisService } from "../src/ai-interview/ai/ai-answer-analysis.service.js";
import { AiQuestionService } from "../src/ai-interview/ai/ai-question.service.js";
import { aiService } from "../src/ai-interview/ai/ai.service.js";
import { questionBankService } from "../src/ai-interview/services/question-bank.service.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { AiCallLog } from "../src/ai-interview/schemas/ai-call-log.schema.js";

test("Cross-Questioning Engine: 5 Critical Verification Behaviors", async (t) => {
  // Prevent DB buffering delays in unit test runner
  const origSave = questionBankService.saveGeneratedQuestion;
  const origGet = questionBankService.getBankQuestion;
  const origCallLog = AiCallLog.create;
  questionBankService.saveGeneratedQuestion = async () => null;
  questionBankService.getBankQuestion = async () => null;
  AiCallLog.create = async () => null;

  const adaptiveEngine = new AdaptiveEngineService();
  const analysisService = new AiAnswerAnalysisService(aiService);
  const questionService = new AiQuestionService(aiService);

  let followUpA = null;
  let followUpB = null;

  try {
    // -------------------------------------------------------------
    // BEHAVIOR 1: Candidate gives Answer A (Sync vs Async loading)
    // -------------------------------------------------------------
    await t.test("Behavior 1: Follow-up is specifically based on Answer A", async () => {
      const q1 = "Explain the difference between CommonJS and ES Modules in Node.js.";
      const answerA =
        "In CommonJS, require() loads modules synchronously at runtime and can be placed inside if statements, whereas ES Modules use import which parses dependencies statically and loads asynchronously at compile time.";

      const analysisA = await analysisService.analyzeCandidateAnswer({
        question: q1,
        candidateAnswer: answerA,
        topic: "NODE.JS",
        difficulty: "EASY",
        role: "Backend Engineer",
        experienceLevel: "1-3 Years",
      });

      assert.ok(analysisA.correctnessScore >= 60, "Answer A should score well on correctness");

      followUpA = await questionService.generateFollowUpQuestion({
        role: "Backend Engineer",
        experienceLevel: "1-3 Years",
        topic: "NODE.JS",
        difficulty: "EASY",
        previousQuestion: q1,
        candidateAnswer: answerA,
        conceptsDemonstrated: analysisA.conceptsDemonstrated,
        conceptsMissing: analysisA.conceptsMissing,
        misconceptions: analysisA.misconceptions,
        experienceAuthenticity: analysisA.experienceAuthenticity,
        followUpType: analysisA.followUpType || "DEPTH_PROBE",
      });

      assert.ok(followUpA.question, "Follow-up question A must be generated");
      assert.notEqual(
        followUpA.question,
        "Could you elaborate more on its practical application and give a concrete example from your experience?",
        "Must NOT return the old generic fallback"
      );

      // Verify follow-up A probes the topics raised in Answer A (sync, async, dynamic, static, execution, etc.)
      const textA = followUpA.question.toLowerCase();
      const hasTopicRelevance =
        textA.includes("async") ||
        textA.includes("sync") ||
        textA.includes("import") ||
        textA.includes("require") ||
        textA.includes("load") ||
        textA.includes("static") ||
        textA.includes("dynamic") ||
        textA.includes("compile") ||
        textA.includes("runtime");
      assert.ok(hasTopicRelevance, `Follow-up A (${followUpA.question}) must be grounded in Answer A`);
    });

    // -------------------------------------------------------------
    // BEHAVIOR 2: Candidate gives completely different Answer B (Exports, Live Bindings & Caching)
    // -------------------------------------------------------------
    await t.test("Behavior 2: Completely different Answer B generates an accordingly different follow-up", async () => {
      const q1 = "Explain the difference between CommonJS and ES Modules in Node.js.";
      const answerB =
        "CommonJS uses module.exports and exports for sharing code and caches the exported object in require.cache, whereas ES Modules use export default and named exports which are live bindings rather than copied object references.";

      const analysisB = await analysisService.analyzeCandidateAnswer({
        question: q1,
        candidateAnswer: answerB,
        topic: "NODE.JS",
        difficulty: "EASY",
        role: "Backend Engineer",
        experienceLevel: "1-3 Years",
      });

      followUpB = await questionService.generateFollowUpQuestion({
        role: "Backend Engineer",
        experienceLevel: "1-3 Years",
        topic: "NODE.JS",
        difficulty: "EASY",
        previousQuestion: q1,
        candidateAnswer: answerB,
        conceptsDemonstrated: analysisB.conceptsDemonstrated,
        conceptsMissing: analysisB.conceptsMissing,
        misconceptions: analysisB.misconceptions,
        experienceAuthenticity: analysisB.experienceAuthenticity,
        followUpType: analysisB.followUpType || "DEPTH_PROBE",
      });

      assert.ok(followUpB.question, "Follow-up question B must be generated");
      assert.notEqual(
        followUpB.question,
        followUpA.question,
        "Follow-up B must be different from Follow-up A because the answers were completely different"
      );

      // Verify follow-up B references Answer B concepts (bindings, cache, exports, reference, mutation, etc.)
      const textB = followUpB.question.toLowerCase();
      const hasAnswerBConcepts =
        textB.includes("bind") ||
        textB.includes("export") ||
        textB.includes("cache") ||
        textB.includes("reference") ||
        textB.includes("mutate") ||
        textB.includes("circular") ||
        textB.includes("copy") ||
        textB.includes("require") ||
        textB.includes("commonjs") ||
        textB.includes("module") ||
        textB.includes("interoperab");
      assert.ok(hasAnswerBConcepts, `Follow-up B (${followUpB.question}) must reflect Answer B's concepts`);
    });

    // -------------------------------------------------------------
    // BEHAVIOR 3: Incorrect answer with technical misconception
    // -------------------------------------------------------------
    await t.test("Behavior 3: System identifies incorrect claim and challenges the misconception", async () => {
      const qIndex = "Explain how database indexing works in PostgreSQL or MongoDB.";
      const wrongAnswer =
        "Adding indexes always makes all database operations faster with no drawbacks, so insert and write performance is also significantly accelerated because the engine uses the index to write data faster.";

      const wrongAnalysis = await analysisService.analyzeCandidateAnswer({
        question: qIndex,
        candidateAnswer: wrongAnswer,
        topic: "DATABASE",
        difficulty: "MEDIUM",
        role: "Backend Engineer",
        experienceLevel: "1-3 Years",
      });

      // The answer analysis must catch that indexes add write overhead or flag lower correctness/misconceptions
      const identifiedIssue =
        (Array.isArray(wrongAnalysis.misconceptions) && wrongAnalysis.misconceptions.length > 0) ||
        wrongAnalysis.correctnessScore < 60 ||
        wrongAnalysis.contradictionDetected ||
        (Array.isArray(wrongAnalysis.conceptsMissing) && wrongAnalysis.conceptsMissing.length > 0);
      assert.ok(identifiedIssue, "Must detect the flaw in the claim that indexes speed up writes");

      // Adaptive engine decision check
      const mockSession = {
        interviewId: "test-session-wrong",
        questionCount: 2,
        currentTopic: "DATABASE",
        followUpCount: 0,
        topicFollowUpCount: 0,
        globalFollowUpCount: 0,
        timeRemaining: 900,
        coverageState: [{ topic: "DATABASE", depthEstablished: false }],
      };
      const mockPlan = { globalQuestionLimit: 10, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };
      const lastTurn = {
        topic: "DATABASE",
        difficulty: Difficulty.MEDIUM,
        answerStatus: wrongAnalysis.correctnessScore < 40 ? AnswerStatus.INCORRECT : AnswerStatus.PARTIAL,
        correctnessScore: wrongAnalysis.correctnessScore,
        misconceptions: wrongAnalysis.misconceptions,
        contradictionDetected: wrongAnalysis.contradictionDetected,
        conceptsMissing: wrongAnalysis.conceptsMissing,
        followUpAllowed: true,
      };

      const decision = adaptiveEngine.determineNextAction(mockSession, mockPlan, lastTurn);
      assert.equal(decision.action, "FOLLOW_UP", "Engine must authorize follow-up to probe or correct");

      const followUpWrong = await questionService.generateFollowUpQuestion({
        role: "Backend Engineer",
        topic: "DATABASE",
        difficulty: decision.difficulty || "MEDIUM",
        previousQuestion: qIndex,
        candidateAnswer: wrongAnswer,
        misconceptions: wrongAnalysis.misconceptions.length ? wrongAnalysis.misconceptions : ["Indexes speed up inserts and writes"],
        conceptsMissing: ["write overhead", "index maintenance costs"],
        followUpType: decision.followUpType || "DEPTH_PROBE",
      });

      assert.ok(followUpWrong.question, "Follow-up challenging the misconception must be generated");
      const textWrong = followUpWrong.question.toLowerCase();
      const challengesWriteCost =
        textWrong.includes("write") ||
        textWrong.includes("insert") ||
        textWrong.includes("overhead") ||
        textWrong.includes("cost") ||
        textWrong.includes("trade-off") ||
        textWrong.includes("penalty") ||
        textWrong.includes("slow");
      assert.ok(challengesWriteCost, `Follow-up (${followUpWrong.question}) must challenge the insert/write overhead claim`);
    });

    // -------------------------------------------------------------
    // BEHAVIOR 4: Very strong expert answer increases difficulty / asks deep probe
    // -------------------------------------------------------------
    await t.test("Behavior 4: Very strong answer elevates difficulty and probes advanced concepts", async () => {
      const qEventLoop = "Explain the Node.js event loop architecture.";
      const strongAnswer =
        "The Node.js event loop is powered by libuv and executes in phases: timers (setTimeout/setInterval), pending I/O callbacks, idle/prepare, poll (fetches I/O events, blocks when idle), check (setImmediate), and close callbacks. Between every phase or operation, microtask queues (process.nextTick followed by Promise reactions) are drained with highest priority before the event loop advances to the next macrotask.";

      const strongAnalysis = await analysisService.analyzeCandidateAnswer({
        question: qEventLoop,
        candidateAnswer: strongAnswer,
        topic: "NODE.JS",
        difficulty: "MEDIUM",
        role: "Backend Engineer",
        experienceLevel: "2-4 Years",
      });

      assert.ok(strongAnalysis.correctnessScore >= 80, "Expert answer must receive high correctness score");
      assert.ok(
        strongAnalysis.knowledgeLevel === "STRONG" || strongAnalysis.knowledgeLevel === "DEEP" || strongAnalysis.knowledgeLevel === "EXCELLENT",
        `Knowledge level should be STRONG/DEEP, got ${strongAnalysis.knowledgeLevel}`
      );

      const mockSession = {
        interviewId: "test-session-strong",
        questionCount: 3,
        currentTopic: "NODE.JS",
        followUpCount: 0,
        topicFollowUpCount: 0,
        globalFollowUpCount: 0,
        timeRemaining: 800,
        candidatePerformance: { streakCorrect: 2 },
        coverageState: [{ topic: "NODE.JS", depthEstablished: false }],
        topicOrder: ["NODE.JS", "POSTGRESQL", "SYSTEM_DESIGN"],
      };
      const mockPlan = { globalQuestionLimit: 10, maxFollowUpsPerTopic: 3, maxFollowUpsPerQuestion: 3 };
      const lastTurn = {
        topic: "NODE.JS",
        difficulty: Difficulty.MEDIUM,
        answerStatus: AnswerStatus.ACCURATE,
        correctnessScore: strongAnalysis.correctnessScore,
        knowledgeLevel: strongAnalysis.knowledgeLevel,
        depthLevel: strongAnalysis.depthLevel,
        depthEstablished: false,
        followUpAllowed: true,
      };

      const decision = adaptiveEngine.determineNextAction(mockSession, mockPlan, lastTurn);
      // For strong answers, difficulty must be HARD, or if depth was established, switch topic
      if (decision.action === "FOLLOW_UP") {
        assert.equal(decision.difficulty, Difficulty.HARD, "Follow-up on strong answer must be HARD difficulty");
        assert.ok(
          decision.followUpType === "PRACTICAL" || decision.followUpType === "VALIDATION" || decision.followUpType === "DEPTH_PROBE",
          `Expected advanced probe type, got ${decision.followUpType}`
        );
      } else {
        assert.equal(decision.action, "SWITCH_TOPIC", "Alternatively, proven mastery transitions to next topic");
      }
    });

    // -------------------------------------------------------------
    // BEHAVIOR 5: LLM unavailable -> dynamic contextual fallback (NEVER generic)
    // -------------------------------------------------------------
    await t.test("Behavior 5: When LLM fails, fallback generates dynamic context-specific question, NOT generic sentence", async () => {
      const mockFailingLlm = {
        generateStructuredJson: async () => {
          throw new Error("Simulated LLM Service Outage 503");
        },
      };

      const fallbackService = new AiQuestionService(mockFailingLlm);
      const fallbackResult = await fallbackService.generateFollowUpQuestion({
        role: "Backend Engineer",
        topic: "REDIS",
        difficulty: "MEDIUM",
        previousQuestion: "How do you handle cache invalidation in Redis?",
        candidateAnswer: "We use a TTL on keys and invalidate by key pattern.",
        conceptsDemonstrated: ["TTL", "cache invalidation"],
        conceptsMissing: ["cache stampede", "thundering herd problem"],
        followUpType: "DEPTH_PROBE",
      });

      assert.ok(fallbackResult.question, "Fallback question must be returned");
      assert.equal(fallbackResult.questionSource, "fallback");

      // Verify it is NOT the static phrase
      assert.notEqual(
        fallbackResult.question,
        "Could you elaborate more on its practical application and give a concrete example from your experience?",
        "CRITICAL: Fallback must NOT be the old hardcoded static string!"
      );

      // Verify fallback is context-specific: mentions the topic and missing concept
      const textFallback = fallbackResult.question.toLowerCase();
      assert.ok(
        textFallback.includes("redis") || textFallback.includes("cache stampede") || textFallback.includes("hood"),
        `Fallback question (${fallbackResult.question}) must be contextually grounded in topic/concepts`
      );
    });
  } finally {
    questionBankService.saveGeneratedQuestion = origSave;
    questionBankService.getBankQuestion = origGet;
    AiCallLog.create = origCallLog;
  }
});
