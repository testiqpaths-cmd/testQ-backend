import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  COMMON_TECHNICAL_V1,
  evaluateCompetencyProfile,
} from "../src/ai-interview/config/competency-profiles.config.js";
import { InterviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { integrityService } from "../src/ai-interview/services/integrity.service.js";

test("Competency Assessment Profile & 7-Parameter Scoring Framework Suite", async (t) => {
  // ==========================================================================
  // 1. Profile Definition & 100% Weight Sum Invariant
  // ==========================================================================
  await t.test("Profile structure: COMMON_TECHNICAL_V1 defines 7 parameters summing to 100%", () => {
    assert.equal(COMMON_TECHNICAL_V1.profileId, "COMMON_TECHNICAL_V1");
    assert.equal(COMMON_TECHNICAL_V1.profileVersion, "1.0.0");

    const params = COMMON_TECHNICAL_V1.parameters;
    const expectedKeys = [
      "technicalKnowledge",
      "problemSolving",
      "practicalApplication",
      "communication",
      "projectUnderstanding",
      "learningAndAdaptability",
      "codeQualityAndTesting",
    ];

    assert.deepEqual(Object.keys(params), expectedKeys);

    // Validate individual percentages
    assert.equal(params.technicalKnowledge.weightPercentage, 25);
    assert.equal(params.problemSolving.weightPercentage, 20);
    assert.equal(params.practicalApplication.weightPercentage, 15);
    assert.equal(params.communication.weightPercentage, 15);
    assert.equal(params.projectUnderstanding.weightPercentage, 10);
    assert.equal(params.learningAndAdaptability.weightPercentage, 10);
    assert.equal(params.codeQualityAndTesting.weightPercentage, 5);

    // Sum of weights must equal 1.0 (100%)
    const totalWeight = Object.values(params).reduce((acc, p) => acc + p.weight, 0);
    assert.equal(Math.round(totalWeight * 100), 100);

    // Each parameter must define distinct proficiency anchors for fresher vs experienced
    for (const key of expectedKeys) {
      assert.ok(params[key].rubric.fresher, `${key} must have fresher rubric anchor`);
      assert.ok(params[key].rubric.experienced, `${key} must have experienced rubric anchor`);
      assert.ok(params[key].actionableSuggestions.low, `${key} must have low score suggestion`);
      assert.ok(params[key].actionableSuggestions.unassessed, `${key} must have unassessed note`);
    }
  });

  // ==========================================================================
  // 2. Rule 1 & 2: Score only what is demonstrated; unassessed is INSUFFICIENT_EVIDENCE (not 0)
  // ==========================================================================
  await t.test("Rule 1 & 2: Unassessed parameter receives INSUFFICIENT_EVIDENCE with score null (never 0)", () => {
    // Session with only technical + problem solving turns, no project and no testing turns
    const turns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "NODE.JS",
        question: "How does the Node.js event loop work?",
        candidateAnswer: "It processes non-blocking I/O via libuv phases.",
        correctnessScore: 90,
        relevanceScore: 95,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 2,
        questionType: "PROBLEM_SOLVING",
        topic: "ALGORITHMS",
        question: "How would you optimize a slow database query?",
        candidateAnswer: "Analyze EXPLAIN ANALYZE output and add covering B-tree indexes.",
        correctnessScore: 88,
        relevanceScore: 90,
        completenessScore: 85,
        confidence: 80,
        answerStatus: "ACCURATE",
      },
    ];

    const result = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, turns, { role: "Backend Developer" });

    // Technical Knowledge & Problem Solving are evaluated
    const techParam = result.competencies.find((c) => c.key === "technicalKnowledge");
    assert.equal(techParam.status, "EVALUATED");
    assert.ok(techParam.score >= 85);

    const problemParam = result.competencies.find((c) => c.key === "problemSolving");
    assert.equal(problemParam.status, "EVALUATED");
    assert.ok(problemParam.score >= 85);

    // Project Understanding was NOT assessed in this interview
    const projectParam = result.competencies.find((c) => c.key === "projectUnderstanding");
    assert.equal(projectParam.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(projectParam.score, null, "Unassessed parameter must NOT be assigned 0");

    // Code Quality and Testing was NOT assessed
    const testingParam = result.competencies.find((c) => c.key === "codeQualityAndTesting");
    assert.equal(testingParam.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(testingParam.score, null, "Unassessed parameter must NOT be assigned 0");
  });

  // ==========================================================================
  // 3. Rule 3: Do not penalize candidate for unassessed skills (re-normalized score)
  // ==========================================================================
  await t.test("Rule 3: Candidate is not penalized for unassessed skills; performance is re-normalized", () => {
    // Candidate scored 90 on technical and 90 on problem solving.
    // If unassessed parameters counted as 0, overall score would drop to 90 * 0.45 = 40.5 (unfair).
    // Re-normalized score must remain ~90!
    const turns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "JAVASCRIPT",
        question: "Explain closures and memory leaks in JavaScript.",
        candidateAnswer: "A closure retains outer lexical scope references. If unreleased in global scope it leaks.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 2,
        questionType: "PROBLEM_SOLVING",
        topic: "ALGORITHMS",
        question: "How would you detect cycles in a directed graph?",
        candidateAnswer: "Using depth first search with three coloring or Kahn's algorithm.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
    ];

    const result = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, turns, { role: "Frontend Developer" });

    // Overall performance score must be re-normalized across evaluated weights (not dragged down to 40)
    assert.ok(
      result.overallPerformanceScore >= 88 && result.overallPerformanceScore <= 92,
      `Expected re-normalized performance ~90, got ${result.overallPerformanceScore}`
    );
  });

  // ==========================================================================
  // 4. Rule 4: Competency coverage is displayed separately from performance
  // ==========================================================================
  await t.test("Rule 4: Competency coverage is calculated and displayed separately from performance", () => {
    const turns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "REACT",
        question: "What is the virtual DOM?",
        candidateAnswer: "In-memory representation of real DOM elements.",
        correctnessScore: 95,
        relevanceScore: 95,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
    ];

    const result = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, turns, { role: "React Developer" });

    // Coverage reflects the proportion of assessed competencies (e.g. 40% when only tech + comm evaluated)
    assert.ok(typeof result.coveragePercentage === "number");
    assert.ok(result.coveragePercentage < 100);
    // Performance reflects how well they did on what was asked (~92%)
    assert.ok(result.overallPerformanceScore >= 90);
    // Both metrics coexist independently
    assert.notEqual(result.coveragePercentage, result.overallPerformanceScore);
  });

  // ==========================================================================
  // 5. Rule 5: Actionable improvement suggestions for low-scoring competencies (< 70)
  // ==========================================================================
  await t.test("Rule 5: Actionable improvement suggestions are provided for competencies scoring below 70", () => {
    const turns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "POSTGRESQL",
        question: "Explain MVCC concurrency in PostgreSQL.",
        candidateAnswer: "PostgreSQL locks all rows on read operations.",
        correctnessScore: 40,
        relevanceScore: 60,
        completenessScore: 40,
        confidence: 50,
        answerStatus: "PARTIAL",
      },
    ];

    const result = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, turns, { role: "Database Engineer" });

    const techParam = result.competencies.find((c) => c.key === "technicalKnowledge");
    assert.ok(techParam.score < 70);
    assert.ok(techParam.actionableFeedback, "Low scoring competency must receive actionable feedback");
    assert.ok(techParam.actionableFeedback.includes("core concepts"));

    // Check compiled actionable suggestions list
    assert.ok(result.actionableSuggestions.length > 0);
    assert.equal(result.actionableSuggestions[0].key, "technicalKnowledge");
  });

  // ==========================================================================
  // 6. Rule 6: Mark score as provisional if important assessment areas lack evidence
  // ==========================================================================
  await t.test("Rule 6: Overall score is marked as provisional when key assessment areas lack sufficient evidence", () => {
    // Only 1 short question asked
    const sparseTurns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "HTML",
        question: "What is doctype?",
        candidateAnswer: "Document type declaration.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 80,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
    ];

    const sparseResult = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, sparseTurns, { role: "Junior Web Dev" });
    assert.equal(sparseResult.isProvisional, true);
    assert.ok(sparseResult.provisionalReason.includes("Provisional assessment"));

    // Complete session covering technical, problem solving, practical, communication, learning, and projects
    const comprehensiveTurns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "NODE.JS",
        question: "Event loop phases?",
        candidateAnswer: "Timers, pending callbacks, poll, check, close callbacks.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 2,
        questionType: "PROBLEM_SOLVING",
        topic: "ALGORITHMS",
        question: "How would you optimize search in a sorted array?",
        candidateAnswer: "Binary search in O(log n) time.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 3,
        questionType: "PRACTICAL",
        topic: "SYSTEMS",
        question: "How do you implement rate limiting in production?",
        candidateAnswer: "Token bucket or leaky bucket using Redis sliding window.",
        correctnessScore: 85,
        relevanceScore: 90,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 4,
        questionType: "PROJECT",
        topic: "PROJECTS",
        question: "What was your contribution to the payment service?",
        candidateAnswer: "I designed the idempotent webhook handler with distributed locking.",
        correctnessScore: 88,
        relevanceScore: 90,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 5,
        questionType: "CLARIFICATION",
        isFollowUp: true,
        topic: "SYSTEMS",
        question: "What happens if Redis fails during the rate limit check?",
        candidateAnswer: "Fail-open with circuit breaker to prevent cascading system outages.",
        correctnessScore: 92,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
    ];

    const comprehensiveResult = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, comprehensiveTurns, {
      role: "Backend Engineer",
    });
    assert.equal(comprehensiveResult.isProvisional, false);
    assert.equal(comprehensiveResult.provisionalReason, null);
    assert.ok(comprehensiveResult.coveragePercentage >= 80);
  });

  // ==========================================================================
  // 7. Fresher Interview Scenario: System Design is not required and not penalized
  // ==========================================================================
  await t.test("Fresher interview scenario: Unassessed System Design does not penalize fresher candidate", () => {
    const fresherTurns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "JAVASCRIPT",
        question: "What is the difference between let, const, and var?",
        candidateAnswer: "var is function scoped and hoisted, while let and const are block scoped.",
        correctnessScore: 95,
        relevanceScore: 95,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 2,
        questionType: "PROBLEM_SOLVING",
        topic: "PROGRAMMING",
        question: "How would you reverse a string without built-in reverse?",
        candidateAnswer: "Two pointer swap approach or a loop from length - 1 down to 0.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 3,
        questionType: "PRACTICAL",
        topic: "REACT",
        question: "How do you fetch and display data in a React component?",
        candidateAnswer: "Use useEffect with axios and set local state with loading and error states.",
        correctnessScore: 88,
        relevanceScore: 90,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
    ];

    const result = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, fresherTurns, {
      role: "Frontend Developer",
      experienceLevel: "Fresher",
    });

    // Project Understanding was not asked -> INSUFFICIENT_EVIDENCE
    const projectParam = result.competencies.find((c) => c.key === "projectUnderstanding");
    assert.equal(projectParam.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(projectParam.score, null);

    // Fresher scored well on what was asked (~91%)
    assert.ok(result.overallPerformanceScore >= 88);
  });

  // ==========================================================================
  // 8. Backwards Compatibility with InterviewResultsService
  // ==========================================================================
  await t.test("Backwards compatibility: InterviewResultsService exposes assessmentProfile and legacy keys", async () => {
    const mockAi = {
      generateInterviewFeedback: async () => ({
        overallFeedback: "Solid technical performance.",
        perQuestion: [],
      }),
    };
    const resultsService = new InterviewResultsService(mockAi);

    const sessionTurns = [
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "NODE.JS",
        question: "Node.js cluster module vs worker threads?",
        candidateAnswer: "Cluster creates separate processes with shared ports; worker threads share memory via ArrayBuffer.",
        correctnessScore: 85,
        relevanceScore: 90,
        completenessScore: 85,
        confidence: 80,
        answerStatus: "ACCURATE",
        processingState: "EVALUATED",
      },
    ];

    const mockSession = {
      _id: new mongoose.Types.ObjectId(),
      interviewId: "int-comp-compat-1",
      role: "Backend Developer",
      experienceLevel: "Fresher",
      interviewState: "COMPLETED",
      coverageState: [{ topic: "NODE.JS", coveragePercentage: 80, knowledgeLevel: "STRONG" }],
    };

    // Calculate legacy competency scores
    const legacyScores = resultsService.computeCompetencyScores(sessionTurns, 85);
    assert.ok(legacyScores.technicalSkills > 0, "Legacy technicalSkills key must exist");

    // Stub turn lookup & integrityService
    const origTurnFind = mongoose.model("InterviewTurn").find;
    const origPlanFindById = mongoose.model("InterviewPlan").findById;
    const origSummaryForSession = integrityService.summaryForSession;

    try {
      integrityService.summaryForSession = async () => ({
        copyPasteCount: 0,
        tabSwitches: 0,
        unusualKeyCount: 0,
      });
      mongoose.model("InterviewTurn").find = () => ({
        sort: () => ({
          lean: async () => sessionTurns,
        }),
      });
      mongoose.model("InterviewPlan").findById = () => ({
        lean: async () => ({ globalQuestionLimit: 10 }),
      });

      const fullResult = await resultsService.computeResultsForSession(mockSession);

      // Verify assessmentProfile presence and fields
      assert.ok(fullResult.assessmentProfile, "assessmentProfile must be present");
      assert.equal(fullResult.assessmentProfile.competencyProfile, "COMMON_TECHNICAL_V1");
      assert.equal(fullResult.assessmentProfile.profileVersion, "1.0.0");
      assert.equal(typeof fullResult.assessmentProfile.coveragePercentage, "number");
      assert.equal(typeof fullResult.isProvisionalScore, "boolean");

      // Verify backwards-compatible competencyScores object
      assert.ok(fullResult.competencyScores.technicalSkills > 0);
      assert.ok(fullResult.competencyScores.technicalKnowledge > 0);
    } finally {
      integrityService.summaryForSession = origSummaryForSession;
      mongoose.model("InterviewTurn").find = origTurnFind;
      mongoose.model("InterviewPlan").findById = origPlanFindById;
    }
  });

  // ==========================================================================
  // 9. Verification 1: Coverage (71.4%) & Score Normalization Independently
  // ==========================================================================
  await t.test("Verification 1: 5 of 7 competencies assessed yields 71.4% parameter coverage and exact weight normalization", () => {
    // 5 assessed competencies: technicalKnowledge (25%), problemSolving (20%), practicalApplication (15%), communication (15%), projectUnderstanding (10%)
    // 2 unassessed: learningAndAdaptability (10%), codeQualityAndTesting (5%)
    const turns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "NODE.JS",
        question: "Explain the libuv threadpool.",
        candidateAnswer: "libuv handles fs and crypto via a pool of 4 worker threads.",
        correctnessScore: 80,
        relevanceScore: 80,
        completenessScore: 80,
        confidence: 80,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 2,
        questionType: "PROBLEM_SOLVING",
        topic: "ALGORITHMS",
        question: "How would you optimize an O(N^2) lookup?",
        candidateAnswer: "Use a hash map or hash set for O(1) average lookups.",
        correctnessScore: 85,
        relevanceScore: 85,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 3,
        questionType: "PRACTICAL",
        topic: "SYSTEMS",
        question: "How would you implement caching for a REST API?",
        candidateAnswer: "Add Redis cache with TTL and cache-aside strategy.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 4,
        questionType: "PROJECT",
        topic: "PROJECTS",
        question: "What was your main role in your recent project?",
        candidateAnswer: "I architected the microservice and database schema.",
        correctnessScore: 75,
        relevanceScore: 75,
        completenessScore: 75,
        confidence: 75,
        answerStatus: "ACCURATE",
      },
    ];

    const result = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, turns, { role: "Backend Developer" });

    // 1. Parameter coverage: 5 of 7 competencies = 71.4%
    assert.equal(result.evaluatedCount, 5);
    assert.equal(result.totalParameters, 7);
    assert.equal(result.parameterCoveragePercentage, 71.4);
    assert.equal(result.coveragePercentage, 71);

    // 2. Evaluated weights sum = 0.25 + 0.20 + 0.15 + 0.15 + 0.10 = 0.85 (85%)
    assert.equal(result.weightedCoveragePercentage, 85);

    // 3. Unassessed competencies are marked INSUFFICIENT_EVIDENCE with score: null
    const learningParam = result.competencies.find((c) => c.key === "learningAndAdaptability");
    assert.equal(learningParam.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(learningParam.score, null);

    const testingParam = result.competencies.find((c) => c.key === "codeQualityAndTesting");
    assert.equal(testingParam.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(testingParam.score, null);

    // 4. Performance score is normalized using the weights of evaluated competencies only
    // Dividend: 80*0.25 + 85*0.20 + 90*0.15 + 83*0.15 (comm) + 75*0.10 = 20 + 17 + 13.5 + 12.45 + 7.5 = 70.45
    // Divisor: 0.85 => 70.45 / 0.85 = 82.88 => 83
    assert.ok(
      result.overallPerformanceScore >= 81 && result.overallPerformanceScore <= 85,
      `Expected normalized score ~83, got ${result.overallPerformanceScore}`
    );
  });

  // ==========================================================================
  // 10. Verification 2: Provisional-Score Policy Conditions
  // ==========================================================================
  await t.test("Verification 2: Provisional-score policy triggers on coverage < 60%, < 4 parameters, or unassessed core tech", () => {
    // Condition A: Core technical knowledge is unassessed / null -> must be provisional
    const noTechTurns = [
      {
        turnNumber: 1,
        questionType: "PROJECT",
        topic: "CAREER_EXPERIENCE",
        question: "Describe your team collaboration.",
        candidateAnswer: "Led daily standups and aligned sprint goals.",
        correctnessScore: 85,
        relevanceScore: 85,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 2,
        questionType: "BEHAVIORAL",
        topic: "CONFLICT_RESOLUTION",
        question: "How do you handle disagreement?",
        candidateAnswer: "Listen and find consensus through data.",
        correctnessScore: 85,
        relevanceScore: 85,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 3,
        questionType: "HR",
        topic: "WORK_ETHIC",
        question: "Why TestQ?",
        candidateAnswer: "Passionate about the mission and culture.",
        correctnessScore: 85,
        relevanceScore: 85,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
      {
        turnNumber: 4,
        questionType: "CLARIFICATION",
        isFollowUp: true,
        topic: "TEAMWORK",
        question: "Can you elaborate on a specific example?",
        candidateAnswer: "Resolved sprint blocker by pairing with junior engineer.",
        correctnessScore: 85,
        relevanceScore: 85,
        completenessScore: 85,
        confidence: 85,
        answerStatus: "ACCURATE",
      },
    ];

    const resultA = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, noTechTurns, { role: "Dev" });
    const techParam = resultA.competencies.find((c) => c.key === "technicalKnowledge");
    assert.equal(techParam.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(techParam.score, null);
    assert.equal(resultA.isProvisional, true);
    assert.ok(resultA.provisionalReason.includes("Core technical knowledge was not assessed"));

    // Condition B: Fewer than 4 parameters evaluated (< 60% coverage) -> must be provisional
    const sparseTurns = [
      {
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "NODE.JS",
        question: "Event loop?",
        candidateAnswer: "libuv loop.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
      },
    ];
    const resultB = evaluateCompetencyProfile(COMMON_TECHNICAL_V1, sparseTurns, { role: "Dev" });
    assert.ok(resultB.evaluatedCount < 4);
    assert.equal(resultB.isProvisional, true);
    assert.ok(resultB.provisionalReason.includes("minimum 4 required"));
  });

  // ==========================================================================
  // 11. Verification 3: End-to-End Report Consistency Across Consumers
  // ==========================================================================
  await t.test("Verification 3: End-to-end report integrity produces unified scores, coverage, and provisional metrics", async () => {
    const mockAi = {
      generateInterviewFeedback: async () => ({
        overallFeedback: "Solid performance with targeted improvement needed in practical coding.",
        perQuestion: [],
      }),
    };
    const resultsService = new InterviewResultsService(mockAi);

    const sessionTurns = [
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 1,
        questionType: "TECHNICAL",
        topic: "NODE.JS",
        question: "Node.js cluster vs worker threads?",
        candidateAnswer: "Cluster uses separate processes; worker threads share memory.",
        correctnessScore: 85,
        relevanceScore: 90,
        completenessScore: 85,
        confidence: 80,
        answerStatus: "ACCURATE",
        processingState: "EVALUATED",
      },
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 2,
        questionType: "PROBLEM_SOLVING",
        topic: "ALGORITHMS",
        question: "Design an LRU cache.",
        candidateAnswer: "Hash map combined with a doubly linked list.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 85,
        answerStatus: "ACCURATE",
        processingState: "EVALUATED",
      },
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 3,
        questionType: "PRACTICAL",
        topic: "SYSTEMS",
        question: "How do you handle memory leaks in production Node.js?",
        candidateAnswer: "Restart the server frequently.", // Low score < 70
        correctnessScore: 50,
        relevanceScore: 60,
        completenessScore: 50,
        confidence: 50,
        answerStatus: "PARTIAL",
        processingState: "EVALUATED",
      },
      {
        _id: new mongoose.Types.ObjectId(),
        turnNumber: 4,
        questionType: "CLARIFICATION",
        isFollowUp: true,
        topic: "SYSTEMS",
        question: "What profiling tools would you use instead?",
        candidateAnswer: "Take heap snapshots using Chrome DevTools or clinic.js to inspect memory retention.",
        correctnessScore: 90,
        relevanceScore: 90,
        completenessScore: 90,
        confidence: 90,
        answerStatus: "ACCURATE",
        processingState: "EVALUATED",
      },
    ];

    const mockSession = {
      _id: new mongoose.Types.ObjectId(),
      interviewId: "int-e2e-report-1",
      role: "Backend Developer",
      experienceLevel: "Fresher",
      interviewState: "COMPLETED",
      coverageState: [{ topic: "NODE.JS", coveragePercentage: 80, knowledgeLevel: "STRONG" }],
    };

    const origTurnFind = mongoose.model("InterviewTurn").find;
    const origPlanFindById = mongoose.model("InterviewPlan").findById;
    const origSummaryForSession = integrityService.summaryForSession;

    try {
      integrityService.summaryForSession = async () => ({ copyPasteCount: 0 });
      mongoose.model("InterviewTurn").find = () => ({
        sort: () => ({
          lean: async () => sessionTurns,
        }),
      });
      mongoose.model("InterviewPlan").findById = () => ({
        lean: async () => ({ globalQuestionLimit: 10 }),
      });

      const report = await resultsService.computeResultsForSession(mockSession);

      // 1. Report contains assessmentProfile
      assert.ok(report.assessmentProfile);
      assert.equal(report.competencyProfile, "COMMON_TECHNICAL_V1");
      assert.equal(report.profileVersion, "1.0.0");

      // 2. Coverage and provisional status are completely unified
      assert.equal(report.competencyCoveragePercentage, report.assessmentProfile.coveragePercentage);
      assert.equal(report.isProvisionalScore, report.assessmentProfile.isProvisional);

      // 3. 5 parameters evaluated (Tech, Problem Solving, Practical, Comm, Learning) >= 4 and >= 60%
      assert.equal(report.assessmentProfile.evaluatedCount, 5);
      assert.equal(report.isProvisionalScore, false);

      // 4. Low scoring Practical Application (< 70) generates actionable suggestions
      assert.ok(report.assessmentProfile.actionableSuggestions.length > 0);
      const practicalSuggestion = report.assessmentProfile.actionableSuggestions.find(
        (s) => s.key === "practicalApplication"
      );
      assert.ok(practicalSuggestion);
      assert.ok(practicalSuggestion.suggestion.includes("real-world implementation patterns"));

      // 5. Unassessed parameters (projectUnderstanding, codeQualityAndTesting) have score null
      const projectComp = report.assessmentProfile.competencies.find((c) => c.key === "projectUnderstanding");
      assert.equal(projectComp.status, "INSUFFICIENT_EVIDENCE");
      assert.equal(projectComp.score, null);
    } finally {
      integrityService.summaryForSession = origSummaryForSession;
      mongoose.model("InterviewTurn").find = origTurnFind;
      mongoose.model("InterviewPlan").findById = origPlanFindById;
    }
  });
});

