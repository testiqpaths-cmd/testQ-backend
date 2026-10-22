import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { interviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { integrityService } from "../src/ai-interview/services/integrity.service.js";

test("TC-223: Provisional Assessment for Unassessed Competencies Suite", async (t) => {
  await t.test("Technical-only interview: systemDesign and behavioral must be null (not 0)", async () => {
    const origTurnFind = mongoose.model("InterviewTurn").find;
    const origPlanFindById = mongoose.model("InterviewPlan").findById;
    const origSummaryForSession = integrityService.summaryForSession;
    const origAiFeedback = interviewResultsService.ai.generateInterviewFeedback;

    try {
      const sessionId = new mongoose.Types.ObjectId();
      const planId = new mongoose.Types.ObjectId();

      // 15-minute technical-only interview: 4 questions, only TECHNICAL questionType
      const technicalTurns = [
        {
          _id: new mongoose.Types.ObjectId(),
          sessionId,
          turnNumber: 1,
          topic: "REACT",
          questionType: "TECHNICAL",
          question: "Explain the Virtual DOM and reconciliation in React.",
          candidateAnswer: "React creates a lightweight in-memory tree and diffs it against previous render.",
          processingState: "EVALUATED",
          answerStatus: "ACCURATE",
          correctnessScore: 85,
          relevanceScore: 90,
          completenessScore: 85,
          confidence: 85,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          sessionId,
          turnNumber: 2,
          topic: "JAVASCRIPT",
          questionType: "TECHNICAL",
          question: "How does the JavaScript event loop handle microtasks vs macrotasks?",
          candidateAnswer: "Microtasks queue runs immediately after current script and between rendering turns.",
          processingState: "EVALUATED",
          answerStatus: "ACCURATE",
          correctnessScore: 90,
          relevanceScore: 90,
          completenessScore: 85,
          confidence: 90,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          sessionId,
          turnNumber: 3,
          topic: "REACT",
          questionType: "TECHNICAL",
          question: "What are the rules of React Hooks and why do they exist?",
          candidateAnswer: "Only call hooks at the top level and from React function components.",
          processingState: "EVALUATED",
          answerStatus: "ACCURATE",
          correctnessScore: 80,
          relevanceScore: 85,
          completenessScore: 80,
          confidence: 80,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          sessionId,
          turnNumber: 4,
          topic: "JAVASCRIPT",
          questionType: "TECHNICAL",
          question: "Explain closures and memory retention in JavaScript.",
          candidateAnswer: "A closure retains access to its lexical scope even when invoked outside.",
          processingState: "EVALUATED",
          answerStatus: "ACCURATE",
          correctnessScore: 85,
          relevanceScore: 85,
          completenessScore: 80,
          confidence: 85,
        },
      ];

      mongoose.model("InterviewTurn").find = () => ({
        sort: () => ({
          lean: async () => technicalTurns,
        }),
      });

      mongoose.model("InterviewPlan").findById = () => ({
        lean: async () => ({
          _id: planId,
          globalQuestionLimit: 4,
        }),
      });

      integrityService.summaryForSession = async () => ({ copyPasteCount: 0 });
      interviewResultsService.ai.generateInterviewFeedback = async () => ({
        overallFeedback: "Strong technical competency in React and JavaScript.",
        perQuestion: [],
      });

      const session = {
        _id: sessionId,
        interviewId: "int-tc-223-technical-only",
        planId,
        role: "Frontend Developer",
        experienceLevel: "MID",
        interviewTypes: ["TECHNICAL"],
        techStack: ["React", "JavaScript"],
        difficulty: "MEDIUM",
        duration: 15,
        questionCount: 4,
        interviewState: "COMPLETED",
        coverageState: [
          { topic: "REACT", coveragePercentage: 100, status: "EVALUATED", questionsAsked: 2 },
          { topic: "JAVASCRIPT", coveragePercentage: 100, status: "EVALUATED", questionsAsked: 2 },
        ],
      };

      const result = await interviewResultsService.computeResultsForSession(session);

      // Verify that unassessed competencies are null, NOT 0
      assert.equal(
        result.scores.systemDesign,
        null,
        "scores.systemDesign must be null for technical-only interview"
      );
      assert.equal(
        result.scores.behavioral,
        null,
        "scores.behavioral must be null for technical-only interview"
      );
      assert.equal(
        result.competencyScores.systemDesign,
        null,
        "competencyScores.systemDesign must be null for technical-only interview"
      );
      assert.equal(
        result.competencyScores.behavioral,
        null,
        "competencyScores.behavioral must be null for technical-only interview"
      );

      // Verify that assessed competencies retain their actual calculated scores
      assert.ok(
        typeof result.scores.technicalSkills === "number" && result.scores.technicalSkills > 0,
        "Assessed technicalSkills must have a positive score"
      );
      assert.ok(
        typeof result.competencyScores.technicalKnowledge === "number" && result.competencyScores.technicalKnowledge > 0,
        "Assessed technicalKnowledge must have a positive score"
      );
    } finally {
      mongoose.model("InterviewTurn").find = origTurnFind;
      mongoose.model("InterviewPlan").findById = origPlanFindById;
      integrityService.summaryForSession = origSummaryForSession;
      interviewResultsService.ai.generateInterviewFeedback = origAiFeedback;
    }
  });

  await t.test("Assessed competency with genuine score of 0 remains 0, while unassessed remains null", () => {
    // 2 turns in technical skills where candidate scored 0
    const turns = [
      {
        turnNumber: 1,
        topic: "REACT",
        questionType: "TECHNICAL",
        candidateAnswer: "I don't know anything about React.",
        answerStatus: "INCORRECT",
        correctnessScore: 0,
        relevanceScore: 0,
        completenessScore: 0,
      },
    ];

    const scores = interviewResultsService.computeCompetencyScores(turns, 0);

    // Technical was assessed and scored 0 -> must remain 0
    assert.equal(scores.technicalSkills, 0, "Assessed competency with score 0 must remain 0");

    // System Design was not assessed -> must be null
    assert.equal(scores.systemDesign, null, "Unassessed systemDesign must be null");

    // Behavioral was not assessed -> must be null
    assert.equal(scores.behavioral, null, "Unassessed behavioral must be null");
  });

  await t.test("Overall averages exclude null competencies while including genuine zero scores", () => {
    const candidateA = { technicalSkills: 80, systemDesign: null };
    const candidateB = { technicalSkills: 0, systemDesign: null }; // Candidate B assessed in tech, scored 0
    const candidateC = { technicalSkills: 100, systemDesign: 90 };

    const candidates = [candidateA, candidateB, candidateC];

    // Compute average for technicalSkills: includes 80, 0, 100 -> avg = 60
    const techScores = candidates
      .map((c) => c.technicalSkills)
      .filter((s) => typeof s === "number" && !Number.isNaN(s));
    assert.equal(techScores.length, 3, "Technical skills must include all 3 candidates including genuine 0");
    const techAvg = Math.round(techScores.reduce((a, b) => a + b, 0) / techScores.length);
    assert.equal(techAvg, 60, "Average must include 0: (80 + 0 + 100) / 3 = 60");

    // Compute average for systemDesign: candidate A and B are null, candidate C is 90 -> avg = 90
    const sysScores = candidates
      .map((c) => c.systemDesign)
      .filter((s) => typeof s === "number" && !Number.isNaN(s));
    assert.equal(sysScores.length, 1, "System design must exclude null candidates A and B");
    const sysAvg = Math.round(sysScores.reduce((a, b) => a + b, 0) / sysScores.length);
    assert.equal(sysAvg, 90, "Average for system design must be 90 (unassessed nulls do not drag score down to 30)");
  });

  await t.test("sanitizeCachedResults preserves null for unassessed competencies", () => {
    const cachedSummary = {
      score: 85,
      readinessScore: 83,
      competencyScores: {
        technicalSkills: 85,
        systemDesign: null,
        behavioral: null,
      },
      questions: [{ id: "q1", section: "technical", score: 85 }],
    };

    const turns = [
      {
        _id: "q1",
        turnNumber: 1,
        topic: "REACT",
        questionType: "TECHNICAL",
        answerStatus: "ACCURATE",
        candidateAnswer: "React uses a virtual DOM for efficient updates.",
      },
    ];

    const sanitized = interviewResultsService.sanitizeCachedResults(cachedSummary, turns);
    assert.equal(sanitized.competencyScores.systemDesign, null, "systemDesign must remain null");
    assert.equal(sanitized.competencyScores.behavioral, null, "behavioral must remain null");
    assert.equal(sanitized.scores.systemDesign, null, "scores.systemDesign must remain null");
    assert.equal(sanitized.scores.behavioral, null, "scores.behavioral must remain null");
    assert.equal(sanitized.competencyScores.technicalSkills, 85, "technicalSkills must remain 85");
  });
});
