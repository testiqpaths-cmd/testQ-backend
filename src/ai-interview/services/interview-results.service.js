import { InterviewSession } from "../schemas/interview-session.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { InterviewPlan } from "../schemas/interview-plan.schema.js";
import { aiFeedbackService } from "../ai/ai-feedback.service.js";
import { integrityService } from "./integrity.service.js";
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

  isTurnSkippedOrUnanswered(turn) {
    if (!turn) return true;
    if (turn.answerStatus === "SKIPPED") return true;
    if (turn.endedReason === "manual_skip" || turn.endedReason === "timeout_no_response") return true;
    const ans = (turn.candidateAnswer || "").trim().toLowerCase();
    if (!ans) return true;
    if (ans === "(skipped)" || ans === "skipped" || ans === "skip" || ans === "pass") return true;
    if (ans === "no response recorded." || ans === "(no response — time expired)") return true;
    return false;
  }

  turnScore(turn) {
    if (this.isTurnSkippedOrUnanswered(turn)) {
      return 0;
    }
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

    if (
      qt === "BEHAVIORAL" ||
      t.includes("BEHAVIORAL") ||
      t.includes("LEADERSHIP") ||
      t.includes("COLLABORATION") ||
      t.includes("ADAPTABILITY") ||
      t.includes("MANAGERIAL") ||
      t.includes("DECISION_MAKING") ||
      t.includes("CHALLENGE")
    ) {
      return "behavioral";
    }
    if (
      qt === "HR" ||
      t.includes("HR") ||
      t.includes("CULTURE") ||
      t.includes("CAREER_GOALS") ||
      t.includes("WORK_ETHIC") ||
      t.includes("TEAMWORK") ||
      t.includes("CONFLICT") ||
      t.includes("COMMUNICATION")
    ) {
      return "communication";
    }
    if (qt === "PROJECT" || t.includes("PROJECT")) return "projects";
    if (
      qt === "PROBLEM_SOLVING" ||
      t.includes("PROBLEM_SOLV") ||
      t.includes("ALGORITHM") ||
      t.includes("DATA_STRUCTURE") ||
      t.includes("TIME_COMPLEXITY")
    ) {
      return "problemSolving";
    }
    if (
      (t.includes("SYSTEM") && t.includes("DESIGN")) ||
      t.includes("ARCHITECTURE") ||
      t.includes("SCALAB") ||
      t.includes("DISTRIBUTED") ||
      t.includes("MICROSERVICES") ||
      t.includes("CACHING")
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
      // Only score competencies that were actually evaluated in this interview.
      // If no questions were asked in this competency (or not attended), score is 0.
      scores[bucket] = turnsInBucket.length
        ? this.round(turnsInBucket.reduce((sum, t) => sum + this.turnScore(t), 0) / turnsInBucket.length)
        : 0;
    }

    const answeredTurns = includedTurns.filter((t) => !this.isTurnSkippedOrUnanswered(t));
    const confidenceValues = answeredTurns.map((t) => t.confidence ?? 0);
    scores.confidence = confidenceValues.length
      ? this.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
      : 0;

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

    const answeredTurns = includedTurns.filter((t) => !this.isTurnSkippedOrUnanswered(t));
    const isUnattended = includedTurns.length === 0 || answeredTurns.length === 0;

    const score = includedTurns.length
      ? this.round(includedTurns.reduce((sum, t) => sum + this.turnScore(t), 0) / includedTurns.length)
      : 0;

    const completionRate = this.clamp(answeredTurns.length / (plan?.globalQuestionLimit || 10), 0, 1);
    const coverageValues = (session.coverageState || []).map((c) => c.coveragePercentage || 0);
    const coverageBreadth = coverageValues.length
      ? coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length / 100
      : 0;

    const readinessScore = isUnattended || score === 0
      ? 0
      : this.clamp(
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
      interviewId: session.interviewId,
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
        answerStatus: t.answerStatus,
        endedReason: t.endedReason || "answered",
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

    // Descriptive proctoring counts only — never scored or turned into a verdict.
    const integritySignals = await integrityService.summaryForSession(session._id);

    // Topic-level knowledge breakdown
    const topicBreakdown = Array.isArray(session.coverageState)
      ? session.coverageState.map((c) => ({
          topic: c.topic,
          topicName: titleCase(c.topic),
          score: c.averageScore || c.bestScore || 0,
          bestScore: c.bestScore || 0,
          averageScore: c.averageScore || 0,
          knowledgeLevel: c.knowledgeLevel || "NONE",
          fundamentalKnowledge: c.fundamentalKnowledge || null,
          advancedDepth: c.advancedDepth || null,
          knowledgeSummary: c.knowledgeSummary || null,
          depthEstablished: Boolean(c.depthEstablished),
          evidenceLevel: c.evidenceLevel || "LOW",
          breadthLevel: c.breadthLevel || "LOW",
          depthLevel: c.depthLevel || "SHALLOW",
          experienceAuthenticity: c.experienceAuthenticity || "UNPROVEN",
          misconceptions: c.misconceptions || [],
          contradictions: c.contradictions || [],
          questionsAsked: c.questionsAsked || 0,
          followupsAsked: c.followupsAsked || 0,
          conceptsTested: c.conceptsTested || [],
          conceptsKnown: c.conceptsKnown || [],
          conceptsMissing: c.conceptsMissing || [],
          status: c.status || "PENDING",
        }))
      : [];

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
      topicBreakdown,
      recommendedPractice: recommendedPractice.slice(0, 5),
      integritySignals,
      phasePlan: Array.isArray(session.phasePlan)
        ? session.phasePlan.map((p) => ({
            phase: p.phase,
            topics: p.topics,
            questionsAsked: p.questionsAsked || 0,
            questionBudget: p.questionBudget || 0,
            status: p.status,
          }))
        : [],
    };
  }

  sanitizeCachedResults(resultsSummary, turns = []) {
    if (!resultsSummary) return resultsSummary;

    const updated = { ...resultsSummary };
    const mappedBuckets = new Set(
      turns.map((t) => this.mapToBucket(t.topic, t.questionType))
    );

    // 1. Sanitize competency scores: Any bucket with 0 turns in this session MUST be 0
    if (updated.competencyScores) {
      const sanitizedComp = { ...updated.competencyScores };
      for (const bucket of COMPETENCY_BUCKETS) {
        if (bucket === "confidence") continue;
        if (!mappedBuckets.has(bucket)) {
          sanitizedComp[bucket] = 0;
        }
      }
      const answeredTurns = turns.filter((t) => !this.isTurnSkippedOrUnanswered(t));
      if (answeredTurns.length === 0) {
        sanitizedComp.confidence = 0;
        for (const bucket of COMPETENCY_BUCKETS) {
          sanitizedComp[bucket] = 0;
        }
      }
      updated.competencyScores = sanitizedComp;
    }

    // 2. Sanitize questions: any skipped or unattempted question must have score = 0
    if (Array.isArray(updated.questions)) {
      updated.questions = updated.questions.map((q) => {
        const matchingTurn = turns.find(
          (t) => t._id?.toString() === q.id || t.turnNumber === q.turnNumber
        );
        const isSkipped =
          this.isTurnSkippedOrUnanswered(q) ||
          (matchingTurn && this.isTurnSkippedOrUnanswered(matchingTurn));

        return {
          ...q,
          score: isSkipped ? 0 : (q.score != null ? q.score : 0),
        };
      });
    }

    // 3. If interview was unattended (0 answered turns), score and readiness must be 0
    const answeredTurns = turns.filter((t) => !this.isTurnSkippedOrUnanswered(t));
    if (turns.length === 0 || answeredTurns.length === 0) {
      updated.score = 0;
      updated.readinessScore = 0;
      if (updated.competencyScores) {
        for (const bucket of COMPETENCY_BUCKETS) {
          updated.competencyScores[bucket] = 0;
        }
      }
    }

    return updated;
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

    const turns = await InterviewTurn.find({ sessionId: session._id }).sort({ turnNumber: 1 }).lean();

    if (session.resultsSummary) {
      const sanitized = this.sanitizeCachedResults(session.resultsSummary, turns);
      session.resultsSummary = sanitized;
      await session.save();
      return sanitized;
    }

    const results = await this.computeResultsForSession(session);

    session.resultsSummary = results;
    session.resultsComputedAt = new Date();
    await session.save();

    logger.info(`Computed and cached interview results for ${session.interviewId}`);

    // First (and only) time results are computed for this session — tell
    // the candidate their report is ready. Non-fatal.
    this.notifyReportReady(session, results);

    return results;
  }

  async notifyReportReady(session, results) {
    try {
      const { createNotification } = await import(
        "../../modules/notification/notification.service.js"
      );
      await createNotification({
        userId: session.userId,
        title: "Your AI interview report is ready",
        message: `${session.role} interview — scored ${results.score}/100 (readiness ${results.readinessScore}/100).`,
        type: "RESULT",
        link: `/dashboard/ai-interview/details/${session.interviewId}`,
        metadata: { interviewId: session.interviewId, score: results.score },
      });
    } catch (err) {
      logger.warn(`Interview completion notification failed (non-fatal): ${err.message}`);
    }
  }
}

export const interviewResultsService = new InterviewResultsService();
export default interviewResultsService;
