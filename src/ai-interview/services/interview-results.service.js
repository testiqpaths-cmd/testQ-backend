import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { aiFeedbackService } from "../ai/ai-feedback.service.js";
import { assertCanViewSession } from "../utils/authorize.js";
import { ApiError } from "../../common/exceptions/ApiError.js";
import logger from "../../config/logger.js";

const TERMINAL_STATES = ["COMPLETED", "EVALUATED", "CANCELLED", "EXPIRED"];

// The 7 buckets the dashboard/details UI's competency chart is built around.
const COMPETENCY_BUCKETS = [
  "technicalSkills",
  "problemSolving",
  "communication",
  "systemDesign",
  "projects",
  "behavioral",
  "confidence",
];

// Known technical labels keep their conventional casing; everything else
// (e.g. multi-word topic keys) falls back to plain title-casing.
const KNOWN_LABELS = {
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  "NODE.JS": "Node.js",
  NODEJS: "Node.js",
  "NEXT.JS": "Next.js",
  MONGODB: "MongoDB",
  POSTGRESQL: "PostgreSQL",
  MYSQL: "MySQL",
  GRAPHQL: "GraphQL",
  HTML: "HTML",
  CSS: "CSS",
  SQL: "SQL",
  AWS: "AWS",
  GCP: "GCP",
  "CI/CD": "CI/CD",
  REST: "REST",
  API: "API",
  UI: "UI",
  UX: "UX",
};

const titleCase = (value) => {
  const key = String(value || "").toUpperCase();
  if (KNOWN_LABELS[key]) return KNOWN_LABELS[key];
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

export class InterviewResultsService {
  constructor(ai = aiFeedbackService) {
    this.ai = ai;
  }

  round(value) {
    return Math.round(Number.isFinite(value) ? value : 0);
  }

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  turnScore(turn) {
    return this.round(
      0.6 * (turn.correctnessScore ?? 0) +
        0.2 * (turn.relevanceScore ?? 0) +
        0.2 * (turn.completenessScore ?? 0)
    );
  }

  /**
   * Own instance of the ownership-check lookup used elsewhere in this
   * module (answer-analysis.service.js, interview-session.service.js) —
   * duplicated rather than imported from interview-session.service.js to
   * avoid a circular import (that file calls into this one).
   */
  async loadOwnedSession(sessionId, user) {
    if (!sessionId) throw new ApiError(400, "Session ID is required.");
    if (!user || !user._id) throw new ApiError(401, "Unauthorized");

    const query = sessionId.toString().startsWith("int-")
      ? { interviewId: sessionId }
      : { _id: sessionId };

    const session = await InterviewSession.findOne(query);
    if (!session) throw new ApiError(404, `Interview session not found: ${sessionId}`);

    // Owner, IQPATH_ADMIN, or an ORGANIZATION user monitoring their own student.
    await assertCanViewSession(user, session);

    return session;
  }

  mapToBucket(topic, questionType) {
    const t = String(topic || "").toUpperCase();
    const qt = String(questionType || "").toUpperCase();

    if (qt === "BEHAVIORAL" || t === "BEHAVIORAL") return "behavioral";
    if (qt === "HR" || t === "HR") return "communication";
    if (qt === "PROJECT" || t.includes("PROJECT")) return "projects";
    if (
      qt === "PROBLEM_SOLVING" ||
      t.includes("PROBLEM_SOLV") ||
      t.includes("ALGORITHM") ||
      t.includes("DATA_STRUCTURE")
    ) {
      return "problemSolving";
    }
    if (
      (t.includes("SYSTEM") && t.includes("DESIGN")) ||
      t.includes("ARCHITECTURE") ||
      t.includes("SCALAB") ||
      t.includes("DISTRIBUTED")
    ) {
      return "systemDesign";
    }
    return "technicalSkills";
  }

  mapToSection(topic, questionType) {
    const bucket = this.mapToBucket(topic, questionType);
    if (bucket === "behavioral") return "behavioral";
    if (bucket === "communication") return "hr";
    if (bucket === "projects") return "projects";
    return "technical";
  }

  computeCompetencyScores(includedTurns, overallScore) {
    const scores = {};
    for (const bucket of COMPETENCY_BUCKETS) {
      if (bucket === "confidence") continue;
      const turnsInBucket = includedTurns.filter(
        (t) => this.mapToBucket(t.topic, t.questionType) === bucket
      );
      scores[bucket] = turnsInBucket.length
        ? this.round(turnsInBucket.reduce((sum, t) => sum + this.turnScore(t), 0) / turnsInBucket.length)
        : overallScore; // no turns mapped -> neutral "not tested" default, not a misleading 0
    }

    const confidenceValues = includedTurns.map((t) => t.confidence ?? 0);
    scores.confidence = confidenceValues.length
      ? this.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
      : overallScore;

    return scores;
  }

  computeStrengthsAndWeaknesses(competencyScores, mappedBuckets, coverageState) {
    const LABELS = {
      technicalSkills: "Technical Skills",
      problemSolving: "Problem Solving",
      communication: "Communication",
      systemDesign: "System Design",
      projects: "Projects",
      behavioral: "Behavioral",
      confidence: "Confidence",
    };

    const strengths = [];
    const weaknesses = [];

    for (const bucket of COMPETENCY_BUCKETS) {
      // Only judge buckets that actually had real turns mapped to them —
      // an unmapped bucket defaulted to the overall score, which isn't a
      // genuine signal either way.
      if (bucket !== "confidence" && !mappedBuckets.has(bucket)) continue;
      const score = competencyScores[bucket];
      if (score >= 75) strengths.push(LABELS[bucket]);
      else if (score < 50) weaknesses.push(LABELS[bucket]);
    }

    for (const c of coverageState || []) {
      const label = titleCase(c.topic);
      if (c.knowledgeLevel === "ADVANCED" && !strengths.includes(label)) strengths.push(label);
      if (c.knowledgeLevel === "NONE" && (c.knowledgeGaps || 0) > 0 && !weaknesses.includes(label)) {
        weaknesses.push(label);
      }
    }

    const dedupe = (arr) => {
      const seen = new Set();
      return arr.filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    // Raw (may be empty) — callers apply a friendly non-empty default only
    // for the final output, so feedback generation sees genuine emptiness
    // and omits the relevant clauses rather than interpolating a placeholder.
    return {
      strengths: dedupe(strengths).slice(0, 4),
      weaknesses: dedupe(weaknesses).slice(0, 4),
    };
  }

  /**
   * Computes (does not cache) the full results block for a session. Called
   * both lazily (first GET after completion) and eagerly (right when a
   * session transitions to a terminal state).
   */
  async computeResultsForSession(session) {
    const [turns, plan] = await Promise.all([
      InterviewTurn.find({ sessionId: session._id }).sort({ turnNumber: 1 }).lean(),
      InterviewPlan.findById(session.planId).lean(),
    ]);

    const includedTurns = turns.filter(
      (t) => t.processingState === "ANALYZED" || t.processingState === "EVALUATED"
    );

    const score = includedTurns.length
      ? this.round(includedTurns.reduce((sum, t) => sum + this.turnScore(t), 0) / includedTurns.length)
      : 0;

    const completionRate = this.clamp(includedTurns.length / (plan?.globalQuestionLimit || 10), 0, 1);
    const coverageValues = (session.coverageState || []).map((c) => c.coveragePercentage || 0);
    const coverageBreadth = coverageValues.length
      ? coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length / 100
      : 0;

    const readinessScore = this.clamp(
      this.round(score * 0.7 + completionRate * 100 * 0.15 + coverageBreadth * 100 * 0.15),
      0,
      100
    );

    const mappedBuckets = new Set(
      includedTurns.map((t) => this.mapToBucket(t.topic, t.questionType))
    );
    const competencyScores = this.computeCompetencyScores(includedTurns, score);
    const { strengths: rawStrengths, weaknesses: rawWeaknesses } =
      this.computeStrengthsAndWeaknesses(competencyScores, mappedBuckets, session.coverageState);

    const strengths = rawStrengths.length
      ? rawStrengths
      : ["Consistent engagement throughout the interview"];
    const weaknesses = rawWeaknesses.length
      ? rawWeaknesses
      : ["Broader topic coverage in your next session"];

    const primaryTurns = includedTurns.filter((t) => !t.isFollowUp);
    const turnsSummary = primaryTurns.map((t) => ({
      turnNumber: t.turnNumber,
      topic: t.topic,
      question: t.question,
      answerStatus: t.answerStatus,
      correctnessScore: t.correctnessScore,
      conceptsDemonstrated: t.conceptsDemonstrated || [],
      conceptsMissing: t.conceptsMissing || [],
      candidateAnswer: (t.candidateAnswer || "").slice(0, 300),
    }));

    const feedback = await this.ai.generateInterviewFeedback({
      role: session.role,
      experienceLevel: session.experienceLevel,
      score,
      readinessScore,
      strengths: rawStrengths,
      weaknesses: rawWeaknesses,
      turnsSummary,
    });

    const feedbackByTurn = new Map(feedback.perQuestion.map((f) => [f.turnNumber, f]));

    const questions = primaryTurns.map((t) => {
      const f = feedbackByTurn.get(t.turnNumber) || {};
      return {
        id: t._id.toString(),
        section: this.mapToSection(t.topic, t.questionType),
        questionText: t.question,
        score: this.turnScore(t),
        yourAnswer: t.candidateAnswer || "No response recorded.",
        aiFeedback: t.feedbackSummary,
        whatWasGood: f.whatWasGood || "",
        whatToImprove: f.whatToImprove || "",
        idealAnswer: f.idealAnswer || "",
      };
    });

    const recommendedPractice = [];
    for (const c of session.coverageState || []) {
      if ((c.knowledgeGaps || 0) > 0 || c.knowledgeLevel === "NONE") {
        const label = titleCase(c.topic);
        if (!recommendedPractice.includes(label)) recommendedPractice.push(label);
      }
    }
    for (const w of rawWeaknesses) {
      if (!recommendedPractice.includes(w)) recommendedPractice.push(w);
    }

    return {
      id: session.interviewId,
      role: session.role,
      roles: [session.role],
      company: session.company,
      experience: session.experienceLevel,
      interviewTypes: session.interviewTypes,
      techStack: session.techStack,
      difficulty: session.difficulty,
      duration: session.duration,
      questionCount: session.questionCount,
      date: session.endTime || session.createdAt,
      status: session.interviewState,
      score,
      readinessScore,
      competencyScores,
      strengths,
      weaknesses,
      overallFeedback: feedback.overallFeedback,
      questions,
      recommendedPractice: recommendedPractice.slice(0, 5),
    };
  }

  /**
   * GET /ai-interview/sessions/:id/details
   * Returns the cached results block, computing (and caching) it on first
   * access if needed. Only available once the interview has reached a
   * terminal state — results are never partial.
   */
  async getInterviewResults(sessionId, user) {
    const session = await this.loadOwnedSession(sessionId, user);

    if (!TERMINAL_STATES.includes(session.interviewState)) {
      throw new ApiError(400, "Interview results are only available after the interview ends.");
    }

    if (session.resultsSummary) {
      return session.resultsSummary;
    }

    const results = await this.computeResultsForSession(session);

    session.resultsSummary = results;
    session.resultsComputedAt = new Date();
    await session.save();

    logger.info(`Computed and cached interview results for ${session.interviewId}`);

    return results;
  }
}

export const interviewResultsService = new InterviewResultsService();
export default interviewResultsService;
