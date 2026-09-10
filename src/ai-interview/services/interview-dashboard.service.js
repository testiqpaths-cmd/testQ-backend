import { InterviewSession } from "../schemas/interview-session.schema.js";

const DEFAULT_TARGET_READINESS_SCORE = 85;
const TREND_LENGTH = 6;

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (value) => Math.round(Number.isFinite(value) ? value : 0);

const shortDate = (date) =>
  new Date(date).toLocaleDateString("en-US", { month: "short", day: "2-digit" });

export class InterviewDashboardService {
  /**
   * Aggregates a candidate's own completed interviews into the dashboard
   * shape the frontend already renders. Every completed session already
   * carries a cached resultsSummary (interview-results.service.js) by the
   * time it's queryable here, so this is pure read/reduce — no scoring
   * logic is duplicated.
   */
  async getDashboard(userId) {
    const sessions = await InterviewSession.find({ userId, interviewState: "COMPLETED" })
      .sort({ createdAt: -1 })
      .select("questionCount createdAt resultsSummary")
      .lean();

    const scores = sessions.map((s) => s.resultsSummary?.score ?? 0);
    const competencyScoresList = sessions
      .map((s) => s.resultsSummary?.competencyScores)
      .filter(Boolean);

    const latest = sessions[0]?.resultsSummary || null;
    const previous = sessions[1]?.resultsSummary || null;
    const readinessScore = latest?.readinessScore ?? 0;

    const stats = {
      totalInterviews: sessions.length,
      averageScore: round(mean(scores)),
      bestScore: sessions.length ? Math.max(...scores) : 0,
      questionsPracticed: sessions.reduce((sum, s) => sum + (s.questionCount || 0), 0),
      readinessScore,
      technicalAccuracy: round(
        mean(competencyScoresList.map((c) => c.technicalSkills ?? 0))
      ),
      communicationScore: round(
        mean(competencyScoresList.map((c) => c.communication ?? 0))
      ),
    };

    const performanceTrend = sessions
      .slice(0, TREND_LENGTH)
      .reverse()
      .map((s) => ({ label: shortDate(s.createdAt), score: s.resultsSummary?.score ?? 0 }));

    const readinessDelta = latest && previous ? readinessScore - (previous.readinessScore ?? 0) : 0;

    return {
      readinessScore,
      readinessDelta,
      targetScore: DEFAULT_TARGET_READINESS_SCORE,
      competencyCoverage: latest?.competencyScores || {
        technicalSkills: 0,
        problemSolving: 0,
        communication: 0,
        systemDesign: 0,
        projects: 0,
        behavioral: 0,
        confidence: 0,
      },
      stats,
      strengths: latest?.strengths || [],
      weaknesses: latest?.weaknesses || [],
      performanceTrend,
    };
  }
}

export const interviewDashboardService = new InterviewDashboardService();
export default interviewDashboardService;
