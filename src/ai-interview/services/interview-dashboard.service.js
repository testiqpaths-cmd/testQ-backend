import { InterviewSession } from "../schemas/interview-session.schema.js";

const DEFAULT_TARGET_READINESS_SCORE = 85;
const TREND_LENGTH = 6;

const COMPETENCY_BUCKETS = [
  "technicalSkills",
  "problemSolving",
  "communication",
  "systemDesign",
  "projects",
  "behavioral",
  "confidence",
];

const DEFAULT_COMPETENCY_COVERAGE = Object.freeze({
  technicalSkills: 0,
  problemSolving: 0,
  communication: 0,
  systemDesign: 0,
  projects: 0,
  behavioral: 0,
  confidence: 0,
});

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (value) => Math.round(Number.isFinite(value) ? value : 0);

const shortDate = (date) =>
  new Date(date).toLocaleDateString("en-US", { month: "short", day: "2-digit" });

export class InterviewDashboardService {
  /**
   * Aggregates a candidate's own completed interviews into the dashboard
   * shape the frontend already renders.
   *
   * - Only COMPLETED (or EVALUATED) sessions are queried.
   * - competencyCoverage aggregates the arithmetic mean for each competency
   *   across all completed interviews. Missing values in any session are safely
   *   excluded without skewing the average down with zeros.
   */
  async getDashboard(userId) {
    const sessions = await InterviewSession.find({
      userId,
      interviewState: { $in: ["COMPLETED", "EVALUATED"] },
    })
      .sort({ createdAt: -1 })
      .select("questionCount createdAt resultsSummary role company difficulty interviewId")
      .lean();

    const validScores = sessions
      .map((s) => s.resultsSummary?.score)
      .filter((v) => typeof v === "number" && Number.isFinite(v));

    const competencyScoresList = sessions
      .map((s) => s.resultsSummary?.competencyScores)
      .filter((c) => c && typeof c === "object");

    // All standard competencies plus any dynamically present keys across sessions
    const allCompetencyKeys = Array.from(
      new Set([
        ...COMPETENCY_BUCKETS,
        ...competencyScoresList.flatMap((c) => Object.keys(c)),
      ])
    );

    const competencyCoverage = { ...DEFAULT_COMPETENCY_COVERAGE };

    for (const key of allCompetencyKeys) {
      const validScoresForKey = competencyScoresList
        .map((c) => c[key])
        .filter((val) => typeof val === "number" && Number.isFinite(val));

      competencyCoverage[key] = validScoresForKey.length
        ? round(validScoresForKey.reduce((sum, val) => sum + val, 0) / validScoresForKey.length)
        : (DEFAULT_COMPETENCY_COVERAGE[key] ?? 0);
    }

    const latest = sessions[0]?.resultsSummary || null;
    const previous = sessions[1]?.resultsSummary || null;
    const readinessScore = latest?.readinessScore ?? 0;

    const stats = {
      totalInterviews: sessions.length,
      averageScore: validScores.length ? round(mean(validScores)) : 0,
      bestScore: validScores.length ? Math.max(...validScores) : 0,
      questionsPracticed: sessions.reduce((sum, s) => sum + (s.questionCount || 0), 0),
      readinessScore,
      technicalAccuracy: competencyCoverage.technicalSkills ?? 0,
      communicationScore: competencyCoverage.communication ?? 0,
    };

    const performanceTrend = sessions
      .map((s) => ({
        id: s.interviewId || s._id,
        date: s.createdAt,
        label: shortDate(s.createdAt),
        role: s.role || "Software Engineer",
        difficulty: s.difficulty || "medium",
        score: s.resultsSummary?.score ?? 0,
        readinessScore: s.resultsSummary?.readinessScore ?? 0,
      }))
      .reverse();

    const readinessDelta = latest && previous ? readinessScore - (previous.readinessScore ?? 0) : 0;

    return {
      readinessScore,
      readinessDelta,
      targetScore: DEFAULT_TARGET_READINESS_SCORE,
      competencyCoverage,
      stats,
      strengths: latest?.strengths || [],
      weaknesses: latest?.weaknesses || [],
      performanceTrend,
    };
  }
}

export const interviewDashboardService = new InterviewDashboardService();
export default interviewDashboardService;
