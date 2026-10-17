import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { QuestionService } from "../src/ai-interview/services/question.service.js";
import { AiQuestionService } from "../src/ai-interview/ai/ai-question.service.js";
import { getFallbackQuestion, FALLBACK_QUESTION_BANK } from "../src/ai-interview/ai/fallback-questions.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";

const candidateA_id = new mongoose.Types.ObjectId();
const candidateB_id = new mongoose.Types.ObjectId();

test("Phase 2: Baseline Difficulty Determination", async (t) => {
  const service = new QuestionService();

  await t.test("ADAPTIVE plan starts Q1 at EASY baseline", () => {
    const diff = service.determineBaselineDifficulty("ADAPTIVE", 1);
    assert.equal(diff, Difficulty.EASY, "Q1 should establish baseline at EASY");
  });

  await t.test("EASY plan starts Q1 at EASY baseline", () => {
    const diff = service.determineBaselineDifficulty("EASY", 1);
    assert.equal(diff, Difficulty.EASY);
  });

  await t.test("MEDIUM plan starts Q1 at EASY baseline", () => {
    const diff = service.determineBaselineDifficulty("MEDIUM", 1);
    assert.equal(diff, Difficulty.EASY);
  });

  await t.test("HARD plan starts Q1 at MEDIUM baseline to gauge level", () => {
    const diff = service.determineBaselineDifficulty("HARD", 1);
    assert.equal(diff, Difficulty.MEDIUM);
  });
});

test("Phase 2: Fallback Questions Bank Reliability", async (t) => {
  await t.test("Returns valid question matching topic and difficulty", () => {
    const fallback = getFallbackQuestion("REACT", "EASY");
    assert.ok(fallback.question, "Should return a question string");
    assert.equal(fallback.topic, "REACT");
    assert.equal(fallback.difficulty, "EASY");
    assert.equal(fallback.questionType, "TECHNICAL");
  });

  await t.test("Never repeats an already asked question if alternatives exist", () => {
    const askedQuestion = FALLBACK_QUESTION_BANK.JAVASCRIPT.EASY[0];
    const fallback = getFallbackQuestion("JAVASCRIPT", "EASY", [askedQuestion]);

    assert.notEqual(
      fallback.question.toLowerCase(),
      askedQuestion.toLowerCase(),
      "Should not select the already asked question"
    );
  });

  await t.test("Gracefully handles unrecognized topics by providing technical fundamentals", () => {
    const fallback = getFallbackQuestion("UNKNOWN_TOPIC_XYZ", "MEDIUM");
    assert.ok(fallback.question);
    assert.equal(fallback.difficulty, "MEDIUM");
  });
});

test("Phase 2: AI Question Service Schema Validation & Fallback Handling", async (t) => {
  await t.test("Uses fallback automatically when LLM returns null or fails", async () => {
    const mockFailingLlm = {
      generateStructuredJson: async () => null,
    };
    const aiQuestionService = new AiQuestionService(mockFailingLlm);

    const result = await aiQuestionService.generateQuestion({
      role: "Frontend Developer",
      topic: "REACT",
      difficulty: "EASY",
    });

    assert.ok(result.question);
    assert.equal(result.topic, "REACT");
    assert.equal(result.difficulty, "EASY");
  });

  await t.test("Uses fallback when LLM returns malformed or invalid schema", async () => {
    const mockMalformedLlm = {
      generateStructuredJson: async () => ({
        wrongField: "invalid data",
      }),
    };
    const aiQuestionService = new AiQuestionService(mockMalformedLlm);

    const result = await aiQuestionService.generateQuestion({
      role: "Backend Engineer",
      topic: "NODE.JS",
      difficulty: "EASY",
    });

    assert.ok(result.question);
    assert.equal(result.topic, "NODE.JS");
  });

  await t.test("Accepts and validates legitimate AI response", async () => {
    const mockGoodLlm = {
      generateStructuredJson: async () => ({
        question: "Explain the difference between SQL indexes and primary keys.",
        topic: "SQL",
        difficulty: "MEDIUM",
        questionType: "TECHNICAL",
        competency: "Technical Knowledge",
      }),
    };
    const aiQuestionService = new AiQuestionService(mockGoodLlm);

    const result = await aiQuestionService.generateQuestion({
      role: "Database Engineer",
      topic: "SQL",
      difficulty: "MEDIUM",
    });

    assert.equal(result.question, "Explain the difference between SQL indexes and primary keys.");
    assert.equal(result.topic, "SQL");
    assert.equal(result.difficulty, "MEDIUM");
  });
});

test("Phase 2: Question Service Backend Validation Constraints", async (t) => {
  const service = new QuestionService();

  await t.test("Rejects generating first question if session state is COMPLETED", async () => {
    const completedSession = {
      interviewState: InterviewState.COMPLETED,
      currentTopic: "JAVASCRIPT",
      timeRemaining: 1000,
    };

    await assert.rejects(
      async () => {
        await service.generateFirstQuestion(completedSession, {});
      },
      /Cannot generate first question: session is in state COMPLETED/
    );
  });

  await t.test("Rejects generating question if interview duration expired", async () => {
    const expiredSession = {
      interviewState: InterviewState.READY,
      currentTopic: "JAVASCRIPT",
      allowedTopics: ["JAVASCRIPT"],
      timeRemaining: 0,
    };

    await assert.rejects(
      async () => {
        await service.generateFirstQuestion(expiredSession, {});
      },
      /Interview duration has expired/
    );
  });

  await t.test("Rejects if active topic is not in allowedTopics", async () => {
    const invalidTopicSession = {
      interviewState: InterviewState.READY,
      currentTopic: "FORBIDDEN_TOPIC",
      allowedTopics: ["REACT", "JAVASCRIPT"],
      timeRemaining: 1200,
    };

    await assert.rejects(
      async () => {
        await service.generateFirstQuestion(invalidTopicSession, {});
      },
      /Topic FORBIDDEN_TOPIC is not in session allowed topics/
    );
  });
});

test("Phase 2: Interview Turn Document Schema Verification", async (t) => {
  await t.test("InterviewTurn document validates required fields and timestamp", () => {
    const turn = new InterviewTurn({
      sessionId: new mongoose.Types.ObjectId(),
      interviewId: "int-12345",
      turnNumber: 1,
      topic: "REACT",
      question: "What is JSX in React?",
      difficulty: Difficulty.EASY,
      competency: "Technical Knowledge",
    });

    assert.equal(turn.turnNumber, 1);
    assert.equal(turn.topic, "REACT");
    assert.equal(turn.difficulty, "EASY");
    assert.ok(turn.questionTimestamp instanceof Date);
    assert.equal(turn.candidateAnswer, null);
    assert.equal(turn.answerStatus, null);
  });
});
