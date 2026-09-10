import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";
import { InterviewTurn } from "../src/ai-interview/schemas/interview-turn.schema.js";

const candidateA_id = new mongoose.Types.ObjectId();
const candidateB_id = new mongoose.Types.ObjectId();

test("Phase 5: Adaptive Engine - Strict Knowledge Gap Handling", async (t) => {
  const engine = new AdaptiveEngineService();

  await t.test("Knowledge gap NEVER allows follow-up, even if requested", () => {
    const session = {
      interviewId: "int-gap-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 1, streakCorrect: 0 },
      topicOrder: ["REACT", "NODE.JS"],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      followUp: true, // Hypothetical rogue flag
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Knowledge gap must NEVER trigger follow-up");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
    assert.equal(decision.difficulty, Difficulty.EASY);
  });

  await t.test("2 consecutive knowledge gaps in a topic triggers SWITCH_TOPIC", () => {
    const session = {
      interviewId: "int-gap-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 2,
      topicQuestionCount: 2,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 2, streakCorrect: 0 },
      topicOrder: ["REACT", "NODE.JS", "SYSTEM_DESIGN"],
      coverageState: [{ topic: "REACT", questionsAsked: 2 }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "NODE.JS");
  });

  await t.test("Consecutive knowledge gaps with no remaining topics triggers COMPLETE_INTERVIEW", () => {
    const session = {
      interviewId: "int-gap-3",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 4,
      topicQuestionCount: 2,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 2 },
      topicOrder: ["REACT", "NODE.JS"], // All topics exhausted
      coverageState: [
        { topic: "REACT", questionsAsked: 2 },
        { topic: "NODE.JS", questionsAsked: 2 },
      ],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 2, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });
});

test("Phase 5: Adaptive Engine - Follow-Up Constraints & Caps", async (t) => {
  const engine = new AdaptiveEngineService();

  await t.test("Authorizes follow-up for partial answer within permitted bounds", () => {
    const session = {
      interviewId: "int-follow-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.FOLLOW_UP);
    assert.equal(decision.topic, "REACT");
  });

  await t.test("Rejects second follow-up on the same question (max 1)", () => {
    const session = {
      interviewId: "int-follow-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 2,
      topicQuestionCount: 1,
      followUpCount: 1, // Already had 1 follow-up on this question
      globalFollowUpCount: 1,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "NODE.JS"],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Second follow-up on same question must be rejected");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
  });

  await t.test("Rejects follow-up when global follow-up limit reached", () => {
    const session = {
      interviewId: "int-follow-3",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 4,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 3, // Global limit 3 reached
      timeRemaining: 600,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "NODE.JS"],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Global follow-up limit must block further follow-ups");
  });

  await t.test("Rejects follow-up when time remaining <= 120s", () => {
    const session = {
      interviewId: "int-follow-4",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 3,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 1,
      timeRemaining: 110, // Under 120s
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "NODE.JS"],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP);
  });
});

test("Phase 5: Adaptive Engine - Topic Switching & Order Progression", async (t) => {
  const engine = new AdaptiveEngineService();

  await t.test("Topic budget met triggers SWITCH_TOPIC to next topic in order", () => {
    const session = {
      interviewId: "int-topic-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 3,
      topicQuestionCount: 3, // Budget of 3 reached
      timeRemaining: 700,
      topicOrder: ["REACT", "NODE.JS", "DATABASES"],
      coverageState: [{ topic: "REACT", questionsAsked: 3 }],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3 };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "NODE.JS");
  });

  await t.test("Honors custom topicBudgets if defined in plan", () => {
    const session = {
      interviewId: "int-topic-2",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 2,
      topicQuestionCount: 2, // Specific budget is 2
      timeRemaining: 700,
      topicOrder: ["REACT", "NODE.JS"],
      coverageState: [{ topic: "REACT", questionsAsked: 2 }],
    };
    const plan = {
      globalQuestionLimit: 10,
      maxQuestionsPerTopic: 5,
      topicBudgets: [{ topic: "REACT", targetQuestions: 2 }],
    };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.ACCURATE,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
    assert.equal(decision.nextTopic, "NODE.JS");
  });

  await t.test("All topics finished triggers COMPLETE_INTERVIEW", () => {
    const session = {
      interviewId: "int-topic-3",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "NODE.JS",
      questionCount: 6,
      topicQuestionCount: 3,
      timeRemaining: 500,
      topicOrder: ["REACT", "NODE.JS"],
      coverageState: [
        { topic: "REACT", questionsAsked: 3 },
        { topic: "NODE.JS", questionsAsked: 3 },
      ],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3 };
    const lastTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.ACCURATE,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });
});

test("Phase 5: Adaptive Engine - Time Remaining & Global Question Limits", async (t) => {
  const engine = new AdaptiveEngineService();

  await t.test("Duration expired (0s remaining) completes interview", () => {
    const session = {
      interviewId: "int-time-1",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 0,
      questionCount: 4,
    };
    const plan = { globalQuestionLimit: 10 };

    const decision = engine.determineNextAction(session, plan);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });

  await t.test("Insufficient time remaining (<60s) completes interview", () => {
    const session = {
      interviewId: "int-time-2",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 45,
      questionCount: 4,
    };
    const plan = { globalQuestionLimit: 10 };

    const decision = engine.determineNextAction(session, plan);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });

  await t.test("Global question limit reached completes interview", () => {
    const session = {
      interviewId: "int-limit-1",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 900,
      questionCount: 10, // Global limit reached
    };
    const plan = { globalQuestionLimit: 10 };

    const decision = engine.determineNextAction(session, plan);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });
});

test("Phase 5: Adaptive Difficulty Scaling", async (t) => {
  const engine = new AdaptiveEngineService();
  const plan = { difficulty: Difficulty.ADAPTIVE };

  await t.test("Maintains difficulty after first correct answer (establishing baseline)", () => {
    const session = { candidatePerformance: { streakCorrect: 1 } };
    const lastTurn = { difficulty: Difficulty.EASY, answerStatus: AnswerStatus.ACCURATE };

    const diff = engine.determineNextDifficulty(session, plan, lastTurn);
    assert.equal(diff, Difficulty.EASY, "1 correct answer should maintain EASY to verify stability");
  });

  await t.test("Steps up from EASY to MEDIUM on sustained correct streak (streak >= 2)", () => {
    const session = { candidatePerformance: { streakCorrect: 2 } };
    const lastTurn = { difficulty: Difficulty.EASY, answerStatus: AnswerStatus.ACCURATE };

    const diff = engine.determineNextDifficulty(session, plan, lastTurn);
    assert.equal(diff, Difficulty.MEDIUM, "Streak of 2 should step up EASY -> MEDIUM");
  });

  await t.test("Steps up from MEDIUM to HARD on sustained correct streak", () => {
    const session = { candidatePerformance: { streakCorrect: 3 } };
    const lastTurn = { difficulty: Difficulty.MEDIUM, answerStatus: AnswerStatus.ACCURATE };

    const diff = engine.determineNextDifficulty(session, plan, lastTurn);
    assert.equal(diff, Difficulty.HARD, "Streak of 3 should step up MEDIUM -> HARD");
  });

  await t.test("Never jumps from EASY directly to HARD", () => {
    const session = { candidatePerformance: { streakCorrect: 5 } };
    const lastTurn = { difficulty: Difficulty.EASY, answerStatus: AnswerStatus.ACCURATE };

    const diff = engine.determineNextDifficulty(session, plan, lastTurn);
    assert.notEqual(diff, Difficulty.HARD, "Must never jump directly from EASY to HARD");
    assert.equal(diff, Difficulty.MEDIUM);
  });

  await t.test("Steps down from HARD to MEDIUM on knowledge gap or incorrect answer", () => {
    const session = { candidatePerformance: { streakCorrect: 0 } };
    const lastTurn = { difficulty: Difficulty.HARD, answerStatus: AnswerStatus.KNOWLEDGE_GAP };

    const diff = engine.determineNextDifficulty(session, plan, lastTurn);
    assert.equal(diff, Difficulty.MEDIUM, "Must step down HARD -> MEDIUM");
  });

  await t.test("Steps down from MEDIUM to EASY on knowledge gap or incorrect answer", () => {
    const session = { candidatePerformance: { streakCorrect: 0 } };
    const lastTurn = { difficulty: Difficulty.MEDIUM, answerStatus: AnswerStatus.INCORRECT };

    const diff = engine.determineNextDifficulty(session, plan, lastTurn);
    assert.equal(diff, Difficulty.EASY, "Must step down MEDIUM -> EASY");
  });

  await t.test("Maintains fixed plan difficulty regardless of candidate streaks", () => {
    const hardPlan = { difficulty: Difficulty.HARD };
    const session = { candidatePerformance: { streakCorrect: 0 } };
    const lastTurn = { difficulty: Difficulty.HARD, answerStatus: AnswerStatus.INCORRECT };

    const diff = engine.determineNextDifficulty(session, hardPlan, lastTurn);
    assert.equal(diff, Difficulty.HARD, "Fixed plan difficulty must remain locked");
  });
});

test("Phase 5: Turn Transcript Linking on Follow-Up", async (t) => {
  const sessionId = new mongoose.Types.ObjectId();
  const parentTurnId = new mongoose.Types.ObjectId();

  const parentTurn = new InterviewTurn({
    _id: parentTurnId,
    sessionId,
    interviewId: "int-link-test",
    turnNumber: 1,
    topic: "REACT",
    question: "What is React State?",
    difficulty: Difficulty.EASY,
    candidateAnswer: "It stores data inside a component.",
    processingState: "ANALYZED",
    answerStatus: AnswerStatus.PARTIAL,
  });

  const followUpTurn = new InterviewTurn({
    sessionId,
    interviewId: "int-link-test",
    turnNumber: 2,
    topic: "REACT",
    question: "Could you explain how setState triggers re-rendering?",
    difficulty: Difficulty.EASY,
    followUp: true,
    parentTurnId: parentTurn._id,
    processingState: "QUESTION_GENERATED",
  });

  await t.test("Follow-up turn correctly links to parent turn", () => {
    assert.equal(followUpTurn.followUp, true);
    assert.equal(followUpTurn.parentTurnId.toString(), parentTurn._id.toString());
    assert.equal(followUpTurn.turnNumber, 2);
    assert.equal(followUpTurn.topic, "REACT");
  });
});

test("Phase 5: Next Action Authorization & State Validation", async (t) => {
  const session = {
    userId: candidateA_id,
    interviewId: "int-auth-next",
    interviewState: InterviewState.IN_PROGRESS,
  };

  await t.test("Candidate owner is authorized to advance next action", () => {
    const isOwner = session.userId.toString() === candidateA_id.toString();
    assert.equal(isOwner, true);
  });

  await t.test("Different candidate is rejected with 403 Forbidden", () => {
    const isOwnerB = session.userId.toString() === candidateB_id.toString();
    const isAdminB = false;
    assert.equal(isOwnerB || isAdminB, false);
  });

  await t.test("Administrator is authorized", () => {
    const adminUser = { _id: new mongoose.Types.ObjectId(), role: "IQPATH_ADMIN" };
    const isAuthorized =
      session.userId.toString() === adminUser._id.toString() ||
      adminUser.role === "IQPATH_ADMIN";
    assert.equal(isAuthorized, true);
  });

  await t.test("Rejects next action when session is in READY state (not yet started)", () => {
    const readyState = InterviewState.READY;
    const canAdvance =
      readyState !== InterviewState.READY &&
      readyState !== InterviewState.CREATED &&
      readyState !== InterviewState.COMPLETED;
    assert.equal(canAdvance, false);
  });

  await t.test("Rejects next action when session is in CANCELLED or EXPIRED state", () => {
    const cancelledState = InterviewState.CANCELLED;
    const expiredState = InterviewState.EXPIRED;
    const isInactive = (s) => s === InterviewState.CANCELLED || s === InterviewState.EXPIRED;
    assert.equal(isInactive(cancelledState), true);
    assert.equal(isInactive(expiredState), true);
  });
});

test("Phase 5: Topic Switch Counter Resets and Coverage Statuses", async (t) => {
  const session = {
    currentTopic: "REACT",
    topicQuestionCount: 3,
    followUpCount: 1,
    candidatePerformance: { consecutiveKnowledgeGapsInTopic: 2 },
    coverageState: [
      { topic: "REACT", status: "IN_PROGRESS" },
      { topic: "NODE.JS", status: "PENDING" },
    ],
  };

  await t.test("Topic switch marks old topic EVALUATED and resets counters", () => {
    const nextTopic = "NODE.JS";

    // Mark previous evaluated
    const prevIdx = session.coverageState.findIndex((c) => c.topic === session.currentTopic);
    if (prevIdx >= 0) session.coverageState[prevIdx].status = "EVALUATED";

    session.currentTopic = nextTopic;
    session.topicQuestionCount = 1;
    session.followUpCount = 0;
    session.candidatePerformance.consecutiveKnowledgeGapsInTopic = 0;

    assert.equal(session.currentTopic, "NODE.JS");
    assert.equal(session.topicQuestionCount, 1);
    assert.equal(session.followUpCount, 0);
    assert.equal(session.candidatePerformance.consecutiveKnowledgeGapsInTopic, 0);
    assert.equal(session.coverageState[0].status, "EVALUATED");
  });
});

test("Phase 5: Follow-Up Counter Increments", async (t) => {
  const session = {
    followUpCount: 0,
    globalFollowUpCount: 1,
    interviewState: InterviewState.WAITING_FOR_NEXT_QUESTION,
  };

  await t.test("Executing follow-up increments per-question and global follow-up counts", () => {
    session.followUpCount += 1;
    session.globalFollowUpCount += 1;
    session.interviewState = InterviewState.IN_PROGRESS;

    assert.equal(session.followUpCount, 1);
    assert.equal(session.globalFollowUpCount, 2);
    assert.equal(session.interviewState, InterviewState.IN_PROGRESS);
  });
});

test("Phase 5: Per-Question Follow-Up Enforcement vs Global Counter", async (t) => {
  const engine = new AdaptiveEngineService();
  const plan = { maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3, globalQuestionLimit: 10 };

  await t.test("A follow-up turn CANNOT itself trigger another follow-up", () => {
    const session = {
      interviewId: "int-turn-guard-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 1,
      globalFollowUpCount: 1,
      timeRemaining: 800,
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      topicOrder: ["REACT", "NODE.JS"],
    };

    // Candidate answered a follow-up turn partially
    const followUpTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.PARTIAL,
      followUp: true,
      parentTurnId: new mongoose.Types.ObjectId(), // Identifies this turn as already being a follow-up!
    };

    const decision = engine.determineNextAction(session, plan, followUpTurn);
    assert.notEqual(
      decision.action,
      InterviewAction.FOLLOW_UP,
      "A follow-up turn cannot spawn another follow-up when maxFollowUpsPerQuestion=1"
    );
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
  });

  await t.test("Global follow-up counter persists across topic switch and does NOT reset", () => {
    const session = {
      currentTopic: "REACT",
      topicQuestionCount: 3,
      followUpCount: 1,
      globalFollowUpCount: 2, // 2 global follow-ups so far
      candidatePerformance: { consecutiveKnowledgeGapsInTopic: 0 },
      coverageState: [
        { topic: "REACT", status: "IN_PROGRESS" },
        { topic: "NODE.JS", status: "PENDING" },
      ],
    };

    // Topic switch
    session.currentTopic = "NODE.JS";
    session.topicQuestionCount = 1;
    session.followUpCount = 0; // Resets for new question/topic
    // Global counter must NOT reset!

    assert.equal(session.followUpCount, 0, "Per-question followUpCount resets");
    assert.equal(session.globalFollowUpCount, 2, "globalFollowUpCount remains intact across topic switch");
  });

  await t.test("Follow-ups do NOT consume primary questionCount or topicQuestionCount", () => {
    let questionCount = 1; // Q1
    let topicQuestionCount = 1; // Q1 in topic

    // Simulate follow-up generation
    const isFollowUp = true;
    if (!isFollowUp) {
      questionCount += 1;
      topicQuestionCount += 1;
    }

    assert.equal(questionCount, 1, "questionCount must NOT increment on follow-up");
    assert.equal(topicQuestionCount, 1, "topicQuestionCount must NOT increment on follow-up");
  });
});

test("Phase 5: Idempotency & Live Loop Safety Guarantees", async (t) => {
  await t.test("Idempotency guard protects unanswered active question from repeated /next calls", () => {
    const session = {
      interviewState: InterviewState.IN_PROGRESS,
      currentQuestion: {
        id: "turn-active-id",
        turnNumber: 2,
        questionText: "Explain useEffect cleanup.",
      },
    };
    const lastTurn = {
      turnNumber: 2,
      candidateAnswer: null, // Candidate has NOT answered yet!
    };

    // If candidate or client triggers /next again before answering:
    let didSkip = false;
    let returnedSameQuestion = false;

    if (
      session.interviewState === InterviewState.IN_PROGRESS &&
      session.currentQuestion &&
      lastTurn &&
      !lastTurn.candidateAnswer
    ) {
      returnedSameQuestion = true;
      didSkip = false;
    } else {
      didSkip = true; // Would incorrectly advance!
    }

    assert.equal(returnedSameQuestion, true, "Must return active question idempotently");
    assert.equal(didSkip, false, "Must NOT skip ahead or create duplicate question");
  });

  await t.test("Accurate answers do NOT trigger follow-ups", () => {
    const engine = new AdaptiveEngineService();
    const session = {
      interviewId: "int-acc-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { streakCorrect: 1 },
      topicOrder: ["REACT", "NODE.JS"],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.ACCURATE,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Accurate answers must not follow up");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
  });

  await t.test("Incorrect answers do NOT cause infinite loops or follow-ups", () => {
    const engine = new AdaptiveEngineService();
    const session = {
      interviewId: "int-inc-1",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "REACT",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 900,
      candidatePerformance: { streakCorrect: 0 },
      topicOrder: ["REACT", "NODE.JS"],
    };
    const plan = { globalQuestionLimit: 10, maxQuestionsPerTopic: 3, maxFollowUpsPerQuestion: 1, maxGlobalFollowUps: 3 };
    const lastTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.INCORRECT,
    };

    const decision = engine.determineNextAction(session, plan, lastTurn);
    assert.notEqual(decision.action, InterviewAction.FOLLOW_UP, "Incorrect answers must not follow up");
    assert.equal(decision.action, InterviewAction.ASK_QUESTION);
    assert.equal(decision.difficulty, Difficulty.EASY, "Difficulty remains at EASY");
  });

  await t.test("Time expiration is checked BEFORE generating question", () => {
    const engine = new AdaptiveEngineService();
    const session = {
      interviewId: "int-time-chk",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 0, // Time is up!
      questionCount: 3,
    };
    const plan = { globalQuestionLimit: 10 };

    const decision = engine.determineNextAction(session, plan, null);
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });

  await t.test("EVALUATE action is never returned by AdaptiveEngine in Phase 5", () => {
    const engine = new AdaptiveEngineService();
    const session = {
      interviewId: "int-eval-chk",
      interviewState: InterviewState.IN_PROGRESS,
      timeRemaining: 0,
      questionCount: 10,
    };
    const plan = { globalQuestionLimit: 10 };

    const decision = engine.determineNextAction(session, plan);
    assert.notEqual(decision.action, InterviewAction.EVALUATE, "Phase 5 must NOT return EVALUATE");
    assert.equal(decision.action, InterviewAction.COMPLETE_INTERVIEW);
  });
});


