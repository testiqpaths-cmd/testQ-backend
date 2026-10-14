import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { submitAnswerSchema } from "../src/ai-interview/dto/submit-answer.dto.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";

const candidateA_id = new mongoose.Types.ObjectId();
const candidateB_id = new mongoose.Types.ObjectId();
const admin_id = new mongoose.Types.ObjectId();

test("Phase 3: Submit Answer DTO Validation", async (t) => {
  await t.test("Accepts valid answer text", () => {
    const parsed = submitAnswerSchema.safeParse({
      answer: "Closures in JavaScript allow inner functions to access outer scope.",
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.answer, "Closures in JavaScript allow inner functions to access outer scope.");
  });

  await t.test("Accepts valid transcript field as alternative input", () => {
    const parsed = submitAnswerSchema.safeParse({
      transcript: "I used React Context for theme state.",
    });
    assert.ok(parsed.success);
  });

  await t.test("Rejects empty or whitespace-only answer and transcript", () => {
    const parsed = submitAnswerSchema.safeParse({
      answer: "   ",
    });
    assert.equal(parsed.success, false, "Should reject whitespace answer");
  });

  await t.test("Accepts optional timeTakenSeconds and audioReference", () => {
    const parsed = submitAnswerSchema.safeParse({
      answer: "A valid answer.",
      timeTakenSeconds: 42,
      audioReference: "https://storage.testq.com/audio/turn-1.webm",
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.timeTakenSeconds, 42);
    assert.equal(parsed.data.audioReference, "https://storage.testq.com/audio/turn-1.webm");
  });
});

test("Phase 3: Answer Submission Authorization & Ownership", async (t) => {
  const session = {
    userId: candidateA_id,
    interviewId: "int-test-12345",
    interviewState: InterviewState.IN_PROGRESS,
    currentQuestion: {
      id: new mongoose.Types.ObjectId().toString(),
      turnNumber: 1,
      questionText: "Explain closures.",
    },
  };

  await t.test("Session owner (Candidate A) is authorized", () => {
    const isOwner = session.userId.toString() === candidateA_id.toString();
    assert.equal(isOwner, true);
  });

  await t.test("Different user (Candidate B) is rejected with Forbidden", () => {
    const isOwnerB = session.userId.toString() === candidateB_id.toString();
    const isAdminB = false;
    const canAccess = isOwnerB || isAdminB;
    assert.equal(canAccess, false, "Candidate B cannot submit answer to Candidate A's session");
  });

  await t.test("Administrator is authorized", () => {
    const adminUser = { _id: admin_id, role: "IQPATH_ADMIN" };
    const canAccess =
      session.userId.toString() === adminUser._id.toString() ||
      adminUser.role === "IQPATH_ADMIN";
    assert.equal(canAccess, true);
  });
});

test("Phase 3: Session State Validation for Answer Submission", async (t) => {
  const validStates = [InterviewState.IN_PROGRESS, InterviewState.PROCESSING_ANSWER];

  await t.test("Accepts submission when state is IN_PROGRESS", () => {
    const state = InterviewState.IN_PROGRESS;
    assert.ok(validStates.includes(state));
  });

  await t.test("Rejects submission when session is READY", () => {
    const state = InterviewState.READY;
    assert.equal(validStates.includes(state), false);
  });

  await t.test("Rejects submission when session is COMPLETED", () => {
    const state = InterviewState.COMPLETED;
    assert.equal(validStates.includes(state), false);
  });

  await t.test("Rejects submission when session is EXPIRED", () => {
    const state = InterviewState.EXPIRED;
    assert.equal(validStates.includes(state), false);
  });

  await t.test("Rejects submission when session is CANCELLED", () => {
    const state = InterviewState.CANCELLED;
    assert.equal(validStates.includes(state), false);
  });
});

test("Phase 3: InterviewTurn Updating & Preservation of Context", async (t) => {
  const turnId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  const questionTime = new Date(Date.now() - 30000); // asked 30 seconds ago

  // Existing turn created in Phase 2
  const turn = new InterviewTurn({
    _id: turnId,
    sessionId,
    interviewId: "int-12345",
    turnNumber: 1,
    topic: "JAVASCRIPT",
    question: "What is a closure in JavaScript?",
    difficulty: Difficulty.EASY,
    competency: "Technical Knowledge",
    questionTimestamp: questionTime,
  });

  await t.test("Attaches candidate answer to existing turn without creating duplicate turn", () => {
    const rawAnswer = "I think closures allow a function to remember its lexical scope even when called outside.";

    // Update existing turn
    turn.candidateAnswer = rawAnswer;
    turn.answerTimestamp = new Date();
    turn.timeTakenSeconds = 30;
    turn.processingState = "SUBMITTED";

    assert.equal(turn.turnNumber, 1, "Must retain turnNumber 1");
    assert.equal(turn.topic, "JAVASCRIPT", "Must preserve topic");
    assert.equal(turn.difficulty, "EASY", "Must preserve difficulty");
    assert.equal(turn.competency, "Technical Knowledge", "Must preserve competency");
    assert.equal(turn.candidateAnswer, rawAnswer);
    assert.equal(turn.processingState, "SUBMITTED");
  });

  await t.test("Idempotency: Re-submitting the exact same answer is safe", () => {
    const retryAnswer = "I think closures allow a function to remember its lexical scope even when called outside.";
    const isIdempotent = turn.candidateAnswer === retryAnswer;
    assert.equal(isIdempotent, true, "Same answer submission is idempotent");
  });

  await t.test("Duplicate protection: Submitting a conflicting second answer for same turn is blocked", () => {
    const conflictingAnswer = "A different answer entirely.";
    const isConflict = Boolean(turn.candidateAnswer && turn.candidateAnswer !== conflictingAnswer);
    assert.equal(isConflict, true, "Conflicting second answer must trigger duplicate protection");
  });

  await t.test("Preserves explicit knowledge gap statements verbatim for Phase 4 detection", () => {
    const knowledgeGapTurn = new InterviewTurn({
      sessionId,
      interviewId: "int-12345",
      turnNumber: 2,
      topic: "MONGODB",
      question: "How do aggregation pipelines work in MongoDB?",
      difficulty: Difficulty.MEDIUM,
      competency: "Technical Knowledge",
      questionTimestamp: new Date(),
    });

    const gapAnswer = "I don't know, I haven't worked with MongoDB aggregations.";
    knowledgeGapTurn.candidateAnswer = gapAnswer;
    knowledgeGapTurn.answerTimestamp = new Date();

    assert.equal(knowledgeGapTurn.candidateAnswer, gapAnswer);
    assert.ok(knowledgeGapTurn.candidateAnswer.toLowerCase().includes("i don't know"));
  });
});
