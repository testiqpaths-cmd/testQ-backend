import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { interviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { integrityService } from "../src/ai-interview/services/integrity.service.js";

test("TC-221: Industry Readiness Score Calculation & Evaluation Integration", async (t) => {
  await t.test("TC-221 Direct: Exact formula weights (0.7, 0.15, 0.15) produce exactly 83 for test inputs", () => {
    // Test input:
    // - Score = 80
    // - CompletionRate = 1.0 (10 out of 10 questions answered)
    // - CoverageBreadth = 0.8 (80% topic coverage)
    // Expected calculation:
    // 0.7 * 80 = 56
    // 0.15 * (1.0 * 100) = 15
    // 0.15 * (0.8 * 100) = 12
    // ReadinessScore = clamp(56 + 15 + 12, 0, 100) = 83
    const score = 80;
    const completionRate = 1.0;
    const coverageBreadth = 0.8;

    const readinessDirect = interviewResultsService.calculateReadinessScore(
      score,
      completionRate,
      coverageBreadth
    );
    assert.equal(readinessDirect, 83, "calculateReadinessScore(80, 1.0, 0.8) must equal exactly 83");

    const readinessObject = interviewResultsService.calculateReadinessScore({
      score,
      completionRate,
      coverageBreadth,
    });
    assert.equal(readinessObject, 83, "calculateReadinessScore({ score: 80, completionRate: 1.0, coverageBreadth: 0.8 }) must equal exactly 83");
  });

  await t.test("TC-221 Percentages vs Decimals: Avoids double multiplication when inputs are already 0-100", () => {
    // When completionRate is passed as 100 (percentage) and coverageBreadth as 80 (percentage)
    const readinessFromPercent = interviewResultsService.calculateReadinessScore(80, 100, 80);
    assert.equal(readinessFromPercent, 83, "Inputs passed as percentages (100, 80) must not be multiplied by 100 twice");
  });

  await t.test("TC-221 Boundary Cases: Handles clamp below 0 and above 100", () => {
    // Below 0 clamp
    const subZero = interviewResultsService.calculateReadinessScore(-50, 0, 0);
    assert.equal(subZero, 0, "Scores below 0 must clamp to 0");

    // Above 100 clamp
    const overHundred = interviewResultsService.calculateReadinessScore(120, 1.0, 1.0);
    assert.equal(overHundred, 100, "Scores above 100 must clamp to 100");
  });

  await t.test("TC-221 Valid Zero Handling: Score = 0 with answered questions is computed correctly, not defaulted or forced to 0", () => {
    // Score = 0, CompletionRate = 1.0, CoverageBreadth = 0.8
    // 0.7 * 0 = 0
    // 0.15 * 100 = 15
    // 0.15 * 80 = 12
    // ReadinessScore = 27
    const zeroScoreReadiness = interviewResultsService.calculateReadinessScore(0, 1.0, 0.8);
    assert.equal(zeroScoreReadiness, 27, "Valid zero score must compute 0 + 15 + 12 = 27 rather than short-circuiting to 0");
  });

  await t.test("TC-221 Partial Completion: Calculates realistic fractional performance accurately", () => {
    // Score = 60, CompletionRate = 0.5 (5/10 answered), CoverageBreadth = 0.4 (40% coverage)
    // 0.7 * 60 = 42
    // 0.15 * 50 = 7.5
    // 0.15 * 40 = 6
    // 42 + 7.5 + 6 = 55.5 -> rounds to 56
    const partialReadiness = interviewResultsService.calculateReadinessScore(60, 0.5, 0.4);
    assert.equal(partialReadiness, 56, "Partial completion must compute 42 + 7.5 + 6 = 55.5 -> 56");
  });

  await t.test("TC-221 End-to-End computeResultsForSession: resultsSummary.readinessScore must equal exactly 83", async () => {
    const origTurnFind = mongoose.model("InterviewTurn").find;
    const origPlanFindById = mongoose.model("InterviewPlan").findById;
    const origSummaryForSession = integrityService.summaryForSession;
    const origAiFeedback = interviewResultsService.ai.generateInterviewFeedback;

    try {
      const sessionId = new mongoose.Types.ObjectId();
      const planId = new mongoose.Types.ObjectId();

      // 10 turns answered with score 80 each (average score = 80)
      const mockTurns = Array.from({ length: 10 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(),
        sessionId,
        turnNumber: i + 1,
        topic: i < 5 ? "REACT" : "JAVASCRIPT",
        questionType: "TECHNICAL",
        question: `Question ${i + 1}`,
        candidateAnswer: `Detailed answer ${i + 1}`,
        processingState: "EVALUATED",
        answerStatus: "ANSWERED",
        correctnessScore: 80,
        relevanceScore: 80,
        completenessScore: 80,
      }));

      mongoose.model("InterviewTurn").find = () => ({
        sort: () => ({
          lean: async () => mockTurns,
        }),
      });

      mongoose.model("InterviewPlan").findById = () => ({
        lean: async () => ({
          _id: planId,
          globalQuestionLimit: 10,
        }),
      });

      integrityService.summaryForSession = async () => ({ copyPasteCount: 0, tabSwitches: 0 });
      interviewResultsService.ai.generateInterviewFeedback = async () => ({
        overallFeedback: "Strong technical performance across React and JavaScript.",
        perQuestion: [],
      });

      const mockSession = {
        _id: sessionId,
        interviewId: "int-tc-221-session",
        planId,
        role: "Frontend Developer",
        experienceLevel: "MID",
        interviewTypes: ["TECHNICAL"],
        techStack: ["React", "JavaScript"],
        difficulty: "MEDIUM",
        duration: 30,
        questionCount: 10,
        interviewState: "COMPLETED",
        coverageState: [
          { topic: "REACT", coveragePercentage: 80, status: "EVALUATED", questionsAsked: 5 },
          { topic: "JAVASCRIPT", coveragePercentage: 80, status: "EVALUATED", questionsAsked: 5 },
        ],
      };

      const resultsSummary = await interviewResultsService.computeResultsForSession(mockSession);

      // Verify exact TC-221 outputs
      assert.equal(resultsSummary.score, 80, "Overall score must equal 80");
      assert.equal(resultsSummary.completionRate, 1.0, "Completion rate must equal 1.0 (10/10 questions)");
      assert.equal(resultsSummary.coverageBreadth, 0.8, "Coverage breadth must equal 0.8 (80% topic coverage)");
      assert.equal(resultsSummary.readinessScore, 83, "resultsSummary.readinessScore must equal exactly 83");

      // Verify report integrity
      assert.ok(Array.isArray(resultsSummary.strengths));
      assert.ok(Array.isArray(resultsSummary.weaknesses));
      assert.ok(resultsSummary.competencyScores);
      assert.equal(resultsSummary.questions.length, 10);
    } finally {
      mongoose.model("InterviewTurn").find = origTurnFind;
      mongoose.model("InterviewPlan").findById = origPlanFindById;
      integrityService.summaryForSession = origSummaryForSession;
      interviewResultsService.ai.generateInterviewFeedback = origAiFeedback;
    }
  });

  await t.test("TC-221 Direct Session Payload: computeResultsForSession accepts explicit score, completionRate, coverageBreadth", async () => {
    const origTurnFind = mongoose.model("InterviewTurn").find;
    const origPlanFindById = mongoose.model("InterviewPlan").findById;
    const origSummaryForSession = integrityService.summaryForSession;
    const origAiFeedback = interviewResultsService.ai.generateInterviewFeedback;

    try {
      mongoose.model("InterviewTurn").find = () => ({
        sort: () => ({
          lean: async () => [],
        }),
      });

      mongoose.model("InterviewPlan").findById = () => ({
        lean: async () => null,
      });

      integrityService.summaryForSession = async () => ({ copyPasteCount: 0 });
      interviewResultsService.ai.generateInterviewFeedback = async () => ({
        overallFeedback: "Solid interview performance.",
        perQuestion: [],
      });

      const sessionWithExplicitMetrics = {
        _id: new mongoose.Types.ObjectId(),
        interviewId: "int-tc-221-explicit",
        role: "Frontend Developer",
        interviewState: "COMPLETED",
        score: 80,
        completionRate: 1.0,
        coverageBreadth: 0.8,
      };

      const resultsSummary = await interviewResultsService.computeResultsForSession(sessionWithExplicitMetrics);

      assert.equal(resultsSummary.score, 80);
      assert.equal(resultsSummary.readinessScore, 83, "resultsSummary.readinessScore must equal exactly 83 for explicit session metrics");
    } finally {
      mongoose.model("InterviewTurn").find = origTurnFind;
      mongoose.model("InterviewPlan").findById = origPlanFindById;
      integrityService.summaryForSession = origSummaryForSession;
      interviewResultsService.ai.generateInterviewFeedback = origAiFeedback;
    }
  });

  await t.test("TC-221 sanitizeCachedResults: preserves readinessScore = 83 on completed interview", () => {
    const cachedSummary = {
      score: 80,
      completionRate: 1.0,
      coverageBreadth: 0.8,
      readinessScore: 83,
      competencyScores: { technicalSkills: 80, confidence: 80 },
      questions: [],
    };

    const sanitized = interviewResultsService.sanitizeCachedResults(cachedSummary, []);
    assert.equal(sanitized.readinessScore, 83, "sanitizeCachedResults must preserve readinessScore = 83");
    assert.equal(sanitized.score, 80, "sanitizeCachedResults must preserve score = 80");
  });
});
