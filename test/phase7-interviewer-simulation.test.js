import test from "node:test";
import assert from "node:assert/strict";
import { InterviewState } from "../src/ai-interview/enums/interview-state.enum.js";
import { InterviewAction } from "../src/ai-interview/enums/interview-action.enum.js";
import { AnswerStatus } from "../src/ai-interview/enums/answer-status.enum.js";
import { Difficulty } from "../src/ai-interview/enums/difficulty.enum.js";
import { AdaptiveEngineService } from "../src/ai-interview/services/adaptive-engine.service.js";

test("Phase 7: Human-Interviewer Simulation Suite (5 Topics x 5 Answer Archetypes = 25 Turns)", async (t) => {
  const engine = new AdaptiveEngineService();

  const plan = {
    globalQuestionLimit: 15,
    maxQuestionsPerTopic: 4,
    maxFollowUpsPerTopic: 3,
    maxFollowUpsPerQuestion: 3,
    maxGlobalFollowUps: 5,
  };

  const topics = [
    { name: "PYTHON", next: "DJANGO" },
    { name: "DJANGO", next: "MYSQL" },
    { name: "MYSQL", next: "REACT" },
    { name: "REACT", next: "SYSTEM_DESIGN" },
    { name: "SYSTEM_DESIGN", next: "DEVOPS" },
  ];

  for (const { name: topic, next: nextTopic } of topics) {
    await t.test(`Simulation Topic: ${topic}`, async (st) => {
      const baseSession = {
        interviewId: `sim-${topic.toLowerCase()}`,
        interviewState: InterviewState.IN_PROGRESS,
        currentTopic: topic,
        questionCount: 1,
        topicQuestionCount: 1,
        followUpCount: 0,
        topicFollowUpCount: 0,
        globalFollowUpCount: 0,
        timeRemaining: 800,
        topicOrder: [topic, nextTopic],
        coverageState: [{ topic, questionsAsked: 1, depthEstablished: false }],
      };

      // 1. Weak Answer -> Clarification follow-up
      await st.test(`${topic} - Archetype 1 [Weak Answer]: Vague definition -> CLARIFICATION probe (EASY)`, () => {
        const turn = {
          difficulty: Difficulty.EASY,
          answerStatus: AnswerStatus.PARTIAL,
          correctnessScore: 35,
          knowledgeLevel: "BASIC",
          depthLevel: "SHALLOW",
          followUpAllowed: true,
          conceptsMissing: [`${topic} basic definition`],
          concept: `${topic} fundamentals`,
        };
        const decision = engine.determineNextAction(baseSession, plan, turn);
        assert.equal(decision.action, InterviewAction.FOLLOW_UP);
        assert.equal(decision.followUpType, "CLARIFICATION");
        assert.equal(decision.difficulty, Difficulty.EASY);
        assert.equal(decision.decisionAudit.trigger, "WEAK_BASIC_ANSWER");
        assert.equal(decision.decisionAudit.decisionConfidence, 0.82);
      });

      // 2. Partial Answer -> Depth probe
      await st.test(`${topic} - Archetype 2 [Partial Answer]: Missing internal mechanics -> DEPTH_PROBE (MEDIUM)`, () => {
        const turn = {
          difficulty: Difficulty.MEDIUM,
          answerStatus: AnswerStatus.PARTIAL,
          correctnessScore: 68,
          knowledgeLevel: "INTERMEDIATE",
          depthLevel: "SHALLOW",
          followUpAllowed: true,
          conceptsMissing: [`${topic} internal execution details`],
        };
        const decision = engine.determineNextAction(baseSession, plan, turn);
        assert.equal(decision.action, InterviewAction.FOLLOW_UP);
        assert.equal(decision.followUpType, "DEPTH_PROBE");
        assert.equal(decision.difficulty, Difficulty.MEDIUM);
        assert.equal(decision.decisionAudit.trigger, "INTERMEDIATE_DEPTH_PROBE");
        assert.equal(decision.decisionAudit.decisionConfidence, 0.86);
      });

      // 3. Strong Answer -> Practical trade-off probe
      await st.test(`${topic} - Archetype 3 [Strong Answer]: Strong grasp -> PRACTICAL probe (HARD)`, () => {
        const turn = {
          difficulty: Difficulty.HARD,
          answerStatus: AnswerStatus.ACCURATE,
          correctnessScore: 86,
          knowledgeLevel: "STRONG",
          depthLevel: "ADEQUATE",
          followUpAllowed: true,
          concept: `${topic} architecture and trade-offs`,
        };
        const decision = engine.determineNextAction(baseSession, plan, turn);
        assert.equal(decision.action, InterviewAction.FOLLOW_UP);
        assert.equal(decision.followUpType, "PRACTICAL");
        assert.equal(decision.difficulty, Difficulty.HARD);
        assert.equal(decision.decisionAudit.trigger, "STRONG_PRACTICAL_PROBE");
        assert.equal(decision.decisionAudit.decisionConfidence, 0.88);
      });

      // 4. Textbook Answer -> Validation follow-up probe (no premature exit)
      await st.test(`${topic} - Archetype 4 [Textbook Answer]: High score with shallow depth -> VALIDATION probe (HARD)`, () => {
        const turn = {
          difficulty: Difficulty.HARD,
          answerStatus: AnswerStatus.ACCURATE,
          correctnessScore: 94,
          depthLevel: "SHALLOW",
          depthEstablished: false,
          experienceAuthenticity: "THEORETICAL_TEXTBOOK",
          followUpAllowed: true,
          concept: `${topic} theory vs production`,
        };
        const decision = engine.determineNextAction(baseSession, plan, turn);
        assert.equal(decision.action, InterviewAction.FOLLOW_UP);
        assert.equal(decision.followUpType, "VALIDATION");
        assert.equal(decision.difficulty, Difficulty.HARD);
        assert.equal(decision.decisionAudit.trigger, "SHALLOW_HIGH_SCORE");
        assert.equal(decision.decisionAudit.decisionConfidence, 0.89);
      });

      // 5. Deep Expert Answer -> Proven depth, early exit to next topic
      await st.test(`${topic} - Archetype 5 [Deep Expert Answer]: Proven depth -> SWITCH_TOPIC early exit`, () => {
        const turn = {
          difficulty: Difficulty.HARD,
          answerStatus: AnswerStatus.ACCURATE,
          correctnessScore: 96,
          knowledgeLevel: "EXCELLENT",
          depthLevel: "DEEP",
          depthEstablished: true,
          experienceAuthenticity: "PRODUCTION_VERIFIED",
          concept: `${topic} production edge cases`,
        };
        const decision = engine.determineNextAction(baseSession, plan, turn);
        assert.equal(decision.action, InterviewAction.SWITCH_TOPIC);
        assert.equal(decision.nextTopic, nextTopic);
        assert.equal(decision.decisionAudit.trigger, "DEPTH_PROVEN_EARLY_EXIT");
        assert.equal(decision.decisionAudit.decisionConfidence, 0.96);
      });
    });
  }

  // Meta-Validation: Decision Confidence Contrast (Ambiguous 0.65 vs Explicit Gap 0.99)
  await t.test("Decision Confidence Contrast: Ambiguous response (0.65) vs Explicit Gap (0.99)", () => {
    const session = {
      interviewId: "sim-conf-contrast",
      interviewState: InterviewState.IN_PROGRESS,
      currentTopic: "PYTHON",
      questionCount: 1,
      topicQuestionCount: 1,
      followUpCount: 0,
      topicFollowUpCount: 0,
      globalFollowUpCount: 0,
      timeRemaining: 800,
      topicOrder: ["PYTHON", "DJANGO"],
      coverageState: [{ topic: "PYTHON", questionsAsked: 1 }],
    };

    // Case A: Ambiguous answer without specific identifiable concept gap
    const ambiguousTurn = {
      difficulty: Difficulty.MEDIUM,
      answerStatus: AnswerStatus.PARTIAL,
      correctnessScore: 45,
      followUpAllowed: true,
      conceptsMissing: [], // Unclear/ambiguous answer
    };
    const ambiguousDecision = engine.determineNextAction(session, plan, ambiguousTurn);
    assert.equal(ambiguousDecision.decisionAudit.decisionConfidence, 0.65, "Ambiguous answer must lower decisionConfidence to 0.65");

    // Case B: Explicit 'I don't know' gap
    const gapTurn = {
      difficulty: Difficulty.EASY,
      answerStatus: AnswerStatus.KNOWLEDGE_GAP,
      isExplicitGap: true,
      followUpAllowed: false,
      concept: "Python GIL",
    };
    const gapDecision = engine.determineNextAction(session, plan, gapTurn);
    assert.equal(gapDecision.decisionAudit.decisionConfidence, 0.99, "Explicit gap must have 0.99 decisionConfidence");
  });
});
