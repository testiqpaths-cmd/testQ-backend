/**
 * InterviewStateBuilderService
 *
 * Deterministic, non-LLM aggregation service that compiles full historical interview
 * turns into a structured, compact evidence state with provenance tracking.
 *
 * Used by the Answer Analysis evaluator to reason over previous evidence,
 * contradictions, and topic progression without transmitting verbatim historical transcripts.
 */

import { InterviewStateSchema } from "../schemas/interview-state.schema.js";

export class InterviewStateBuilderService {
  /**
   * Compiles session context and prior turns into a compact InterviewState object.
   *
   * @param {Object} session - InterviewSession document or object
   * @param {Array<Object>} previousTurns - Full chronological past turns from MongoDB
   * @param {Object} [currentQuestion=null] - The current question being evaluated
   * @returns {Object} Structured compact interview state
   */
  buildState(session = {}, previousTurns = [], currentQuestion = null) {
    const validTurns = Array.isArray(previousTurns)
      ? previousTurns.filter(
          (t) => t && (t.candidateAnswer || t.processingState === "ANALYZED" || t.processingState === "EVALUATED")
        )
      : [];

    const testedConceptsMap = new Map();
    const misconceptionsList = [];
    const missingConceptsMap = new Map();
    const topicStatsMap = new Map();

    // 1. Process Turns Chronologically
    for (const turn of validTurns) {
      const turnNum = turn.turnNumber || 1;
      const topic = (turn.topic || "GENERAL").toUpperCase();
      const score = typeof turn.correctnessScore === "number" ? turn.correctnessScore : null;

      // 1a. Topic stats aggregation
      if (!topicStatsMap.has(topic)) {
        topicStatsMap.set(topic, { scores: [], turns: [] });
      }
      const tStat = topicStatsMap.get(topic);
      tStat.turns.push(turnNum);
      if (score !== null) tStat.scores.push(score);

      // 1b. Demonstrated Concepts (provenance tracking)
      const demonstrated = Array.isArray(turn.conceptsDemonstrated)
        ? turn.conceptsDemonstrated
        : [];
      for (const concept of demonstrated) {
        if (!concept || typeof concept !== "string") continue;
        const key = concept.trim().toLowerCase();
        // Record concept with provenance
        testedConceptsMap.set(key, {
          concept: concept.trim(),
          evidence: (turn.candidateAnswer || "").trim().slice(0, 120),
          confidence: score !== null ? Math.min(1.0, score / 100) : 0.8,
          turn: turnNum,
        });
      }

      // 1c. Misconceptions
      const mis = Array.isArray(turn.misconceptions) ? turn.misconceptions : [];
      for (const item of mis) {
        if (!item || typeof item !== "string") continue;
        misconceptionsList.push({
          concept: turn.concept || topic,
          claim: item.trim(),
          turn: turnNum,
        });
      }

      // 1d. Missing Concepts
      const missing = Array.isArray(turn.conceptsMissing) ? turn.conceptsMissing : [];
      for (const item of missing) {
        if (!item || typeof item !== "string") continue;
        const key = item.trim().toLowerCase();
        missingConceptsMap.set(key, {
          concept: item.trim(),
          turn: turnNum,
        });
      }
    }

    // 2. Structured Topic Mastery
    const topicMastery = {};
    for (const [topic, stat] of topicStatsMap.entries()) {
      const avgScore = stat.scores.length
        ? Math.round(stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length)
        : 60;
      let level = "INTERMEDIATE";
      if (avgScore >= 85) level = "EXCELLENT";
      else if (avgScore >= 75) level = "STRONG";
      else if (avgScore < 50) level = "BASIC";

      topicMastery[topic] = {
        level,
        avgScore,
        confidence: Math.min(0.95, Number((0.55 + 0.1 * stat.turns.length).toFixed(2))),
        evidenceTurns: stat.turns,
      };
    }

    // 3. Resume Claims Validation
    const rawClaims = [
      ...(session.resumeData?.extracted?.skills || []),
      ...(session.resumeData?.parsedData?.skills || []),
      ...(session.techStack || []),
      ...(session.skillsToAssess || []),
    ];
    // Deduplicate unique skill strings
    const uniqueClaims = Array.from(new Set(rawClaims.map((c) => String(c).trim()))).filter(Boolean);

    const resumeClaimsValidated = uniqueClaims.map((claim) => {
      const claimLower = claim.toLowerCase();
      // Find turns relevant to this claim
      const relevantTurns = validTurns.filter((t) => {
        const tTopic = (t.topic || "").toLowerCase();
        const tConcept = (t.concept || "").toLowerCase();
        const tQ = (t.question || "").toLowerCase();
        return (
          tTopic.includes(claimLower) ||
          claimLower.includes(tTopic) ||
          tConcept.includes(claimLower) ||
          tQ.includes(claimLower)
        );
      });

      if (!relevantTurns.length) {
        return {
          claim,
          status: "UNPROVEN",
          evidenceTurn: null,
        };
      }

      const scores = relevantTurns
        .map((t) => t.correctnessScore)
        .filter((s) => typeof s === "number");
      const avg = scores.length
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 50;

      const latestTurn = relevantTurns[relevantTurns.length - 1];
      let status = "UNPROVEN";
      if (avg >= 75) status = "SUPPORTED";
      else if (avg >= 50) status = "PARTIALLY_SUPPORTED";

      return {
        claim,
        status,
        evidenceTurn: latestTurn.turnNumber || null,
      };
    });

    // 4. Recent Context (last 1–2 turns only, bounded text length)
    const recentTurns = validTurns.slice(-2).map((t) => ({
      turnNumber: t.turnNumber,
      topic: t.topic || "GENERAL",
      question: (t.question || "").trim(),
      candidateAnswer: (t.candidateAnswer || "").trim().slice(0, 300),
      depthLevel: t.depthLevel || "ADEQUATE",
    }));

    const resultState = {
      testedConcepts: Array.from(testedConceptsMap.values()),
      misconceptions: misconceptionsList,
      missingConcepts: Array.from(missingConceptsMap.values()),
      topicMastery,
      resumeClaimsValidated: resumeClaimsValidated.slice(0, 10), // Bound to top 10 relevant claims
      recentTurns,
      currentQuestion: currentQuestion
        ? {
            question: currentQuestion.question || "",
            topic: currentQuestion.topic || "GENERAL",
            difficulty: currentQuestion.difficulty || "MEDIUM",
          }
        : null,
      totalTurnsCompleted: validTurns.length,
      currentTopic: session.currentTopic || "GENERAL",
      currentDifficulty: session.difficulty || "MEDIUM",
    };

    // Safe validation
    const parsed = InterviewStateSchema.safeParse(resultState);
    return parsed.success ? parsed.data : resultState;
  }

  /**
   * Formats the compact InterviewState into a concise text block for the LLM prompt.
   *
   * @param {Object} state - Output of buildState()
   * @returns {string} Compact prompt block
   */
  formatStateForPrompt(state) {
    if (!state || state.totalTurnsCompleted === 0) {
      return "";
    }

    const lines = ["Structured Interview Evidence:"];

    // Tested Concepts (bounded to latest 10 to keep prompt strictly stable)
    if (state.testedConcepts?.length) {
      const conceptsStr = state.testedConcepts
        .slice(-10)
        .map((c) => `${c.concept} (T${c.turn})`)
        .join(", ");
      lines.push(`• Verified Concepts: ${conceptsStr}`);
    }

    // Misconceptions
    if (state.misconceptions?.length) {
      const misStr = state.misconceptions
        .slice(-6)
        .map((m) => `"${m.claim}" on ${m.concept} (T${m.turn})`)
        .join("; ");
      lines.push(`• Known Misconceptions: ${misStr}`);
    }

    // Missing Concepts
    if (state.missingConcepts?.length) {
      const missStr = state.missingConcepts
        .slice(-6)
        .map((m) => `${m.concept} (T${m.turn})`)
        .join(", ");
      lines.push(`• Missing Details: ${missStr}`);
    }

    // Topic Mastery
    if (state.topicMastery && Object.keys(state.topicMastery).length) {
      const masteryStr = Object.entries(state.topicMastery)
        .map(([topic, m]) => `${topic}: ${m.level} (turns: ${m.evidenceTurns.join(",")})`)
        .join(" | ");
      lines.push(`• Topic Mastery: ${masteryStr}`);
    }

    // Resume Claims
    const validatedClaims = (state.resumeClaimsValidated || []).filter(
      (c) => c.status !== "UNPROVEN"
    );
    if (validatedClaims.length) {
      const claimsStr = validatedClaims
        .slice(-6)
        .map((c) => `${c.claim}: ${c.status} (T${c.evidenceTurn})`)
        .join(", ");
      lines.push(`• Resume Claims: ${claimsStr}`);
    }

    // Recent 1–2 turns (concise snippet)
    if (state.recentTurns?.length) {
      lines.push("• Recent Context (last 1-2 turns):");
      for (const t of state.recentTurns) {
        const shortAns = (t.candidateAnswer || "").length > 120
          ? `${t.candidateAnswer.slice(0, 117)}...`
          : t.candidateAnswer;
        lines.push(`  [Turn ${t.turnNumber} - ${t.topic}] Q: "${t.question}" -> A: "${shortAns}"`);
      }
    }

    return lines.join("\n");
  }
}

export const interviewStateBuilderService = new InterviewStateBuilderService();
export default interviewStateBuilderService;
