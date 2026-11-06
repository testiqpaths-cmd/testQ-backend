/**
 * TestQ Competency Assessment Profiles Configuration
 *
 * Implements the COMMON_TECHNICAL_V1 7-parameter assessment framework for all technical interviews.
 * Designed to be extensible for future experience-aware profiles (e.g. FRESHER_TECHNICAL_V1,
 * MID_LEVEL_BACKEND_V1, SENIOR_SYSTEM_DESIGN_V1) while preserving reporting consistency.
 */

export const COMPETENCY_PROFILES = {
  COMMON_TECHNICAL_V1: "COMMON_TECHNICAL_V1",
};

export const COMMON_TECHNICAL_V1 = {
  profileId: "COMMON_TECHNICAL_V1",
  profileVersion: "1.0.0",
  name: "Common Technical Assessment Profile",
  description:
    "Standard 7-parameter technical evaluation profile for all software engineering and developer interviews.",
  totalWeight: 100,

  /**
   * The 7 core assessment parameters and their baseline weights
   */
  parameters: {
    technicalKnowledge: {
      key: "technicalKnowledge",
      label: "Technical Knowledge",
      weight: 0.25,
      weightPercentage: 25,
      description: "Understanding of relevant concepts, tools, and technologies.",
      essential: true, // Key assessment area required for non-provisional score
      rubric: {
        fresher: "Programming fundamentals, syntax, data types, standard library methods.",
        experienced: "Technical depth, internal runtime mechanics, trade-offs, architecture choices.",
      },
      actionableSuggestions: {
        low: "Strengthen core concepts and runtime fundamentals for the target tech stack. Review syntax and key API methods.",
        unassessed: "Technical knowledge was not directly evaluated in this session.",
      },
    },
    problemSolving: {
      key: "problemSolving",
      label: "Problem Solving",
      weight: 0.20,
      weightPercentage: 20,
      description: "Logical reasoning, approach, and ability to solve unfamiliar problems.",
      essential: true,
      rubric: {
        fresher: "Basic logic, algorithmic steps, structured thinking on coding problems.",
        experienced: "Complex debugging, distributed problem analysis, edge case anticipation.",
      },
      actionableSuggestions: {
        low: "Practice structured problem breakdown: identify constraints, state edge cases, and outline your approach before diving into details.",
        unassessed: "Practice algorithmic and logic-based problems to build problem-solving evidence.",
      },
    },
    practicalApplication: {
      key: "practicalApplication",
      label: "Practical Application",
      weight: 0.15,
      weightPercentage: 15,
      description: "Applying knowledge to coding, debugging, projects, or real-world scenarios.",
      essential: true,
      rubric: {
        fresher: "Academic or personal projects, practical library use, basic implementation.",
        experienced: "Production systems, operational troubleshooting, real-world constraints.",
      },
      actionableSuggestions: {
        low: "Focus on real-world implementation patterns, common debugging techniques, and production trade-offs.",
        unassessed: "Demonstrate practical coding and real-world scenario handling in future sessions.",
      },
    },
    communication: {
      key: "communication",
      label: "Communication",
      weight: 0.15,
      weightPercentage: 15,
      description: "Explaining reasoning, decisions, and solutions clearly.",
      essential: true,
      rubric: {
        fresher: "Explaining approach clearly, active listening, structured articulation.",
        experienced: "Explaining decisions, trade-offs, concise technical rationale.",
      },
      actionableSuggestions: {
        low: "Structure answers using a top-down method: state the direct answer first, then provide rationale and examples.",
        unassessed: "Provide detailed explanations and clear verbal reasoning during responses.",
      },
    },
    projectUnderstanding: {
      key: "projectUnderstanding",
      label: "Project Understanding",
      weight: 0.10,
      weightPercentage: 10,
      description: "Understanding implementation, personal contribution, and technical decisions.",
      essential: false, // Optional if not asked in fresher interview
      rubric: {
        fresher: "Explaining personal project contributions, role, and tech stack choices.",
        experienced: "Technical ownership, system architecture, and consequential engineering decisions.",
      },
      actionableSuggestions: {
        low: "Deepen familiarity with your project contributions, architectural decisions, and why specific technologies were chosen over alternatives.",
        unassessed: "Include project-based discussions in future sessions to assess system ownership.",
      },
    },
    learningAndAdaptability: {
      key: "learningAndAdaptability",
      label: "Learning and Adaptability",
      weight: 0.10,
      weightPercentage: 10,
      description: "Responding to hints, correcting mistakes, and learning from feedback.",
      essential: false,
      rubric: {
        fresher: "Responding constructively to hints, acknowledging knowledge gaps, adjusting reasoning.",
        experienced: "Adapting to new constraints, correcting assumptions, navigating ambiguity.",
      },
      actionableSuggestions: {
        low: "Pay close attention to interviewer follow-ups and hints; incorporate feedback promptly to refine your reasoning.",
        unassessed: "Adaptability wasn't tested because no follow-up hints or constraint changes were needed.",
      },
    },
    codeQualityAndTesting: {
      key: "codeQualityAndTesting",
      label: "Code Quality and Testing",
      weight: 0.05,
      weightPercentage: 5,
      description: "Correctness, maintainability, edge cases, and testing where relevant.",
      essential: false,
      rubric: {
        fresher: "Basic correctness, clean variable naming, basic boundary checks.",
        experienced: "Maintainability, automated testing strategies, reliability, edge cases.",
      },
      actionableSuggestions: {
        low: "Emphasize edge case handling, clean modular design, and proactive discussion of unit testing and error boundaries.",
        unassessed: "Practice writing test cases and discussing edge-case robustness in code.",
      },
    },
  },

  /**
   * Evidence Policy rules
   */
  evidencePolicy: {
    minEvaluatedTurnsForCompetency: 1,
    minEvaluatedWeightForNonProvisional: 0.60, // >= 60% of weighted competencies must be assessed
    minEvaluatedParametersForNonProvisional: 4, // At least 4 of 7 parameters
    insufficientEvidenceStatus: "INSUFFICIENT_EVIDENCE",
    evaluatedStatus: "EVALUATED",
    notApplicableStatus: "NOT_APPLICABLE",
  },
};

/**
 * Helper to determine turn score safely
 */
function getTurnScore(turn) {
  if (!turn) return 0;
  if (turn.answerStatus === "SKIPPED") return 0;
  const ans = (turn.candidateAnswer || "").trim().toLowerCase();
  if (!ans || ans === "(skipped)" || ans === "no response recorded." || ans === "(no response — time expired)") {
    return 0;
  }
  const correctness = turn.correctnessScore ?? 0;
  const relevance = turn.relevanceScore ?? 0;
  const completeness = turn.completenessScore ?? 0;
  return Math.round(0.6 * correctness + 0.2 * relevance + 0.2 * completeness);
}

/**
 * Checks if a turn is a valid, answered turn
 */
function isAnsweredTurn(turn) {
  if (!turn) return false;
  if (turn.answerStatus === "SKIPPED") return false;
  const ans = (turn.candidateAnswer || "").trim().toLowerCase();
  if (!ans || ans === "(skipped)" || ans === "no response recorded." || ans === "(no response — time expired)") {
    return false;
  }
  return true;
}

/**
 * Evaluates a session against a competency profile (e.g. COMMON_TECHNICAL_V1)
 * Adheres to all 6 scoring rules:
 * 1. Score only what the candidate actually demonstrates.
 * 2. If a parameter was not assessed, mark INSUFFICIENT_EVIDENCE (never 0).
 * 3. Do not penalize candidate for unassessed skills (re-normalize across evaluated weights).
 * 4. Competency coverage is calculated and displayed separately from performance.
 * 5. Actionable improvement suggestions provided for competencies scoring < 70.
 * 6. Mark overall score as provisional if important assessment areas lack sufficient evidence.
 */
export function evaluateCompetencyProfile(
  profile = COMMON_TECHNICAL_V1,
  includedTurns = [],
  session = {},
  plan = {}
) {
  const answeredTurns = includedTurns.filter(isAnsweredTurn);
  const isUnattended = includedTurns.length === 0 || answeredTurns.length === 0;

  const resultCompetencies = [];
  let evaluatedWeightSum = 0;
  let evaluatedWeightedScoreSum = 0;
  let evaluatedCount = 0;

  // Helper map for turns matching specific criteria
  const turnsByParam = {
    technicalKnowledge: [],
    problemSolving: [],
    practicalApplication: [],
    communication: [],
    projectUnderstanding: [],
    learningAndAdaptability: [],
    codeQualityAndTesting: [],
  };

  for (const turn of answeredTurns) {
    const qType = String(turn.questionType || "").toUpperCase();
    const topic = String(turn.topic || "").toUpperCase();
    const questionText = String(turn.question || "").toLowerCase();

    // 1. Technical Knowledge: all core technical, conceptual, or system design turns
    if (
      qType === "TECHNICAL" ||
      qType === "CONCEPTUAL" ||
      qType === "DEPTH_PROBE" ||
      topic.includes("SYSTEM") ||
      topic.includes("DESIGN") ||
      topic.includes("DATABASE") ||
      topic.includes("NODE") ||
      topic.includes("REACT") ||
      topic.includes("JAVASCRIPT") ||
      topic.includes("PYTHON") ||
      topic.includes("SQL")
    ) {
      turnsByParam.technicalKnowledge.push(turn);
    }

    // 2. Problem Solving: algorithmic, logic, troubleshooting, debugging, trade-off questions
    if (
      qType === "PROBLEM_SOLVING" ||
      qType === "SCENARIO" ||
      turn.difficulty === "HARD" ||
      questionText.includes("how would you solve") ||
      questionText.includes("debug") ||
      questionText.includes("troubleshoot") ||
      questionText.includes("algorithm") ||
      questionText.includes("trade-off") ||
      questionText.includes("optimize") ||
      topic.includes("ALGORITHM") ||
      topic.includes("PROBLEM_SOLV") ||
      topic.includes("DATA_STRUCTURE")
    ) {
      turnsByParam.problemSolving.push(turn);
    }

    // 3. Practical Application: practical, scenario, real-world implementation, coding tasks
    if (
      qType === "PRACTICAL" ||
      qType === "SCENARIO" ||
      questionText.includes("implement") ||
      questionText.includes("in production") ||
      questionText.includes("build") ||
      questionText.includes("create") ||
      questionText.includes("configure") ||
      topic.includes("PROJECT") ||
      topic.includes("PRACTICAL")
    ) {
      turnsByParam.practicalApplication.push(turn);
    }

    // 4. Communication: evaluated across answered turns based on explanation clarity,
    // relevance, completeness, and consistency (confidence is folded here, not independent)
    turnsByParam.communication.push(turn);

    // 5. Project Understanding: project-specific questions, resume/portfolio contribution, ownership
    if (
      qType === "PROJECT" ||
      topic.includes("PROJECT") ||
      topic.includes("RESUME") ||
      topic.includes("EXPERIENCE") ||
      questionText.includes("your project") ||
      questionText.includes("contribution") ||
      questionText.includes("architectural decision")
    ) {
      turnsByParam.projectUnderstanding.push(turn);
    }

    // 6. Learning & Adaptability: follow-up probes, hints, clarification, overcoming misconceptions
    if (
      turn.isFollowUp ||
      qType === "CLARIFICATION" ||
      qType === "VALIDATION" ||
      qType === "DEPTH_PROBE" ||
      (turn.misconceptions && turn.misconceptions.length > 0)
    ) {
      turnsByParam.learningAndAdaptability.push(turn);
    }

    // 7. Code Quality and Testing: code syntax, unit testing, mock, edge case handling, clean code
    if (
      questionText.includes("test") ||
      questionText.includes("edge case") ||
      questionText.includes("unit test") ||
      questionText.includes("code quality") ||
      questionText.includes("refactor") ||
      questionText.includes("clean code") ||
      topic.includes("TESTING") ||
      topic.includes("QA")
    ) {
      turnsByParam.codeQualityAndTesting.push(turn);
    }
  }

  // Fallback heuristic: If technical questions were asked but specific tags like problemSolving
  // or practicalApplication had no explicit keyword match, use general technical turns when appropriate
  if (turnsByParam.problemSolving.length === 0 && answeredTurns.length >= 3) {
    // Candidates answering multiple technical questions demonstrated reasoning
    turnsByParam.problemSolving = answeredTurns.filter(
      (t) => t.difficulty === "MEDIUM" || t.difficulty === "HARD"
    );
  }
  if (turnsByParam.practicalApplication.length === 0 && answeredTurns.length >= 2) {
    // If questions were applied technical topics
    turnsByParam.practicalApplication = answeredTurns.filter(
      (t) => !t.isFollowUp && t.questionType !== "CONCEPTUAL"
    );
  }

  // Iterate each parameter in the profile
  for (const [key, paramDef] of Object.entries(profile.parameters)) {
    const matchingTurns = turnsByParam[key] || [];

    if (isUnattended) {
      // Unattended interview: 0 score across board
      resultCompetencies.push({
        key,
        name: paramDef.label,
        weight: paramDef.weight,
        weightPercentage: paramDef.weightPercentage,
        score: 0,
        status: "EVALUATED",
        evidenceLevel: "NONE",
        turnsCount: 0,
        description: paramDef.description,
        rubric: paramDef.rubric,
        actionableFeedback: "Candidate did not attend or provide answers in this session.",
      });
      continue;
    }

    if (matchingTurns.length === 0) {
      // Rule 2 & 3: Parameter not assessed -> INSUFFICIENT_EVIDENCE with score: null (NOT 0)
      resultCompetencies.push({
        key,
        name: paramDef.label,
        weight: paramDef.weight,
        weightPercentage: paramDef.weightPercentage,
        score: null,
        status: profile.evidencePolicy.insufficientEvidenceStatus,
        evidenceLevel: "NONE",
        turnsCount: 0,
        description: paramDef.description,
        rubric: paramDef.rubric,
        actionableFeedback: paramDef.actionableSuggestions.unassessed,
      });
      continue;
    }

    // Parameter is evaluated
    let calculatedScore;
    if (key === "communication") {
      // Communication folds explanation clarity, relevance, completeness, and consistency
      const avgRelevance =
        matchingTurns.reduce((s, t) => s + (t.relevanceScore ?? 70), 0) / matchingTurns.length;
      const avgCompleteness =
        matchingTurns.reduce((s, t) => s + (t.completenessScore ?? 70), 0) / matchingTurns.length;
      const avgConfidence =
        matchingTurns.reduce((s, t) => s + (t.confidence ?? 75), 0) / matchingTurns.length;
      // 40% relevance, 40% completeness, 20% consistency/clarity (confidence)
      calculatedScore = Math.round(0.4 * avgRelevance + 0.4 * avgCompleteness + 0.2 * avgConfidence);
    } else {
      const turnScores = matchingTurns.map(getTurnScore);
      calculatedScore = Math.round(turnScores.reduce((s, v) => s + v, 0) / turnScores.length);
    }

    // Evidence Level based on number of turns
    let evidenceLevel = "LOW";
    if (matchingTurns.length >= 3) evidenceLevel = "HIGH";
    else if (matchingTurns.length >= 2) evidenceLevel = "MEDIUM";

    // Actionable improvement feedback
    let actionableFeedback = null;
    if (calculatedScore < 70) {
      actionableFeedback = paramDef.actionableSuggestions.low;
    }

    evaluatedWeightSum += paramDef.weight;
    evaluatedWeightedScoreSum += calculatedScore * paramDef.weight;
    evaluatedCount += 1;

    resultCompetencies.push({
      key,
      name: paramDef.label,
      weight: paramDef.weight,
      weightPercentage: paramDef.weightPercentage,
      score: calculatedScore,
      status: profile.evidencePolicy.evaluatedStatus,
      evidenceLevel,
      turnsCount: matchingTurns.length,
      description: paramDef.description,
      rubric: paramDef.rubric,
      actionableFeedback,
    });
  }

  // Rule 3: Re-normalized overall score across evaluated parameters
  const overallPerformanceScore =
    evaluatedWeightSum > 0 ? Math.round(evaluatedWeightedScoreSum / evaluatedWeightSum) : 0;

  // Rule 4: Competency coverage calculated separately from performance
  const totalParameters = Object.keys(profile.parameters).length;
  const parameterCoverageRatio = totalParameters > 0 ? evaluatedCount / totalParameters : 0;
  const parameterCoveragePercentage = Math.round(parameterCoverageRatio * 1000) / 10; // e.g. 71.4%
  const coveragePercentage = Math.round(parameterCoverageRatio * 100);
  const weightedCoveragePercentage = Math.round(evaluatedWeightSum * 100);

  // Rule 6: Mark score as provisional if important areas lack sufficient evidence:
  // - coverage below 60% (either parameter coverage or weighted coverage)
  // - fewer than 4 parameters evaluated
  // - core technical knowledge is unassessed (status !== "EVALUATED" or score is null)
  const techComp = resultCompetencies.find((c) => c.key === "technicalKnowledge");
  const technicalKnowledgeAssessed =
    techComp?.status === "EVALUATED" && typeof techComp?.score === "number";

  const isProvisional =
    !isUnattended &&
    (coveragePercentage < 60 ||
      evaluatedWeightSum < 0.60 ||
      evaluatedCount < 4 ||
      !technicalKnowledgeAssessed);

  let provisionalReason = null;
  if (isProvisional) {
    if (!technicalKnowledgeAssessed) {
      provisionalReason =
        "Provisional assessment: Core technical knowledge was not assessed in this session.";
    } else if (evaluatedCount < 4) {
      provisionalReason = `Provisional assessment: Only ${evaluatedCount} of ${totalParameters} competencies (${parameterCoveragePercentage}% coverage) had sufficient evidence in this session (minimum 4 required).`;
    } else {
      provisionalReason = `Provisional assessment: Competency coverage (${coveragePercentage}%) is below the 60% threshold for a definitive assessment.`;
    }
  }

  // Compile actionable recommendations for all low-scoring competencies (Rule 5)
  const lowCompetencies = resultCompetencies.filter((c) => c.status === "EVALUATED" && c.score < 70);
  const actionableSuggestions = lowCompetencies.map((c) => ({
    competency: c.name,
    key: c.key,
    score: c.score,
    suggestion: c.actionableFeedback,
  }));

  return {
    competencyProfile: profile.profileId,
    profileVersion: profile.profileVersion,
    profileName: profile.name,
    isProvisional,
    provisionalReason,
    coveragePercentage,
    parameterCoveragePercentage,
    weightedCoveragePercentage,
    evaluatedCount,
    totalParameters,
    overallPerformanceScore,
    competencies: resultCompetencies,
    actionableSuggestions,
  };
}
