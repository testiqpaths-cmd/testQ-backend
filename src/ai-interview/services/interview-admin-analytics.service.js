import mongoose from "mongoose";
import User from "../../models/user.model.js";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

const round = (v) => Math.round(Number.isFinite(v) ? v : 0);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

const COMPETENCY_LABELS = {
  technicalSkills: "Technical Skills",
  problemSolving: "Problem Solving",
  communication: "Communication",
  confidence: "Confidence",
  systemDesign: "System Design",
  projects: "Projects",
  behavioral: "Behavioral",
};

export class InterviewAdminAnalyticsService {
  /**
   * Resolves in-scope student IDs based on user role.
   * IQPATH_ADMIN -> all students (optionally narrowed by ?organizationId=)
   * ORGANIZATION -> only students belonging to that organization
   */
  async resolveStudentScope(user, query = {}) {
    if (user.role === "IQPATH_ADMIN") {
      const filter = { role: "STUDENT", isDeleted: { $ne: 1 } };
      if (query.organizationId && mongoose.Types.ObjectId.isValid(query.organizationId)) {
        filter.organizationId = query.organizationId;
      }
      const totalStudents = await User.countDocuments(filter);
      return { filter, totalStudents };
    }

    if (user.role === "ORGANIZATION") {
      if (!user.organizationId) {
        throw new ApiError(403, "Organization account not linked to an organization.");
      }
      const filter = {
        role: "STUDENT",
        organizationId: user.organizationId,
        isDeleted: { $ne: 1 },
      };
      const totalStudents = await User.countDocuments(filter);
      return { filter, totalStudents };
    }

    throw new ApiError(403, "Access restricted to administrators.");
  }

  fullName(u) {
    if (!u) return "Unknown";
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return name || u.email || "Unknown";
  }

  /**
   * Main analytics aggregation endpoint for the Admin AI Interview page.
   */
  async getAdminAnalytics(user, query = {}) {
    const { timeRange = "all", role, status, search, page = 1, limit = 20 } = query;
    const { totalStudents } = await this.resolveStudentScope(user, query);

    // Build date filter
    const dateQuery = {};
    const now = Date.now();
    if (timeRange === "7d") {
      dateQuery.createdAt = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
    } else if (timeRange === "30d") {
      dateQuery.createdAt = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
    } else if (timeRange === "90d") {
      dateQuery.createdAt = { $gte: new Date(now - 90 * 24 * 60 * 60 * 1000) };
    }

    // Query all sessions matching date filter for aggregate analytics
    const allSessions = await InterviewSession.find(dateQuery)
      .populate("userId", "firstName lastName email")
      .sort({ createdAt: -1 })
      .lean();

    // ── 1. Overview Statistics ──
    const totalInterviews = allSessions.length;
    const completedSessions = allSessions.filter(
      (s) => (s.interviewState === "COMPLETED" || s.interviewState === "EVALUATED") && s.resultsSummary
    );
    const inProgressSessions = allSessions.filter((s) =>
      ["IN_PROGRESS", "PROCESSING_ANSWER", "WAITING_FOR_NEXT_QUESTION", "EVALUATING"].includes(
        s.interviewState
      )
    );
    const abandonedSessions = allSessions.filter((s) =>
      ["CANCELLED", "EXPIRED", "CREATED", "READY"].includes(s.interviewState)
    );

    const completedScores = completedSessions
      .map((s) => s.resultsSummary?.score)
      .filter((v) => typeof v === "number");
    const completedReadiness = completedSessions
      .map((s) => s.resultsSummary?.readinessScore)
      .filter((v) => typeof v === "number");

    const averageScore = round(mean(completedScores));
    const averageReadiness = round(mean(completedReadiness));
    const completionRate = totalInterviews > 0 ? round((completedSessions.length / totalInterviews) * 100) : 0;

    const uniqueStudentsSet = new Set();
    allSessions.forEach((s) => {
      const uid = s.userId?._id?.toString() || s.userId?.toString();
      if (uid) uniqueStudentsSet.add(uid);
    });
    const totalStudentsPracticed = uniqueStudentsSet.size;

    // ── 2. Time-Series Trends (Daily, Weekly, Monthly) ──
    const dailyMap = new Map();
    const weeklyMap = new Map();
    const monthlyMap = new Map();

    const getWeekKey = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
      return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    };

    allSessions.forEach((s) => {
      const d = new Date(s.createdAt);
      const dayKey = d.toISOString().slice(0, 10);
      const weekKey = getWeekKey(d);
      const monthKey = d.toISOString().slice(0, 7);

      const isCompleted = s.interviewState === "COMPLETED" || s.interviewState === "EVALUATED";
      const score = isCompleted && typeof s.resultsSummary?.score === "number" ? s.resultsSummary.score : null;
      const readiness = isCompleted && typeof s.resultsSummary?.readinessScore === "number" ? s.resultsSummary.readinessScore : null;

      // Daily
      if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { date: dayKey, attempts: 0, completed: 0, scores: [], readiness: [] });
      const dayEntry = dailyMap.get(dayKey);
      dayEntry.attempts += 1;
      if (isCompleted) dayEntry.completed += 1;
      if (score != null) dayEntry.scores.push(score);
      if (readiness != null) dayEntry.readiness.push(readiness);

      // Weekly
      if (!weeklyMap.has(weekKey)) weeklyMap.set(weekKey, { week: weekKey, attempts: 0, completed: 0, scores: [], readiness: [] });
      const weekEntry = weeklyMap.get(weekKey);
      weekEntry.attempts += 1;
      if (isCompleted) weekEntry.completed += 1;
      if (score != null) weekEntry.scores.push(score);
      if (readiness != null) weekEntry.readiness.push(readiness);

      // Monthly
      if (!monthlyMap.has(monthKey)) monthlyMap.set(monthKey, { month: monthKey, attempts: 0, completed: 0, scores: [], readiness: [] });
      const monthEntry = monthlyMap.get(monthKey);
      monthEntry.attempts += 1;
      if (isCompleted) monthEntry.completed += 1;
      if (score != null) monthEntry.scores.push(score);
      if (readiness != null) monthEntry.readiness.push(readiness);
    });

    const formatTrend = (map, keyName) =>
      [...map.values()]
        .sort((a, b) => a[keyName].localeCompare(b[keyName]))
        .map((e) => ({
          label: e[keyName],
          attempts: e.attempts,
          completed: e.completed,
          inProgress: Math.max(0, e.attempts - e.completed),
          averageScore: round(mean(e.scores)),
          averageReadiness: round(mean(e.readiness)),
        }));

    const trends = {
      daily: formatTrend(dailyMap, "date").slice(-30),
      weekly: formatTrend(weeklyMap, "week").slice(-12),
      monthly: formatTrend(monthlyMap, "month").slice(-12),
    };

    // ── 3. Score Distribution Across Ranges ──
    const scoreRanges = [
      { range: "0-39%", label: "Needs Improvement", count: 0, color: "#EF4444" },
      { range: "40-59%", label: "Developing", count: 0, color: "#F59E0B" },
      { range: "60-79%", label: "Proficient", count: 0, color: "#3B82F6" },
      { range: "80-100%", label: "Ready / Advanced", count: 0, color: "#10B981" },
    ];

    completedScores.forEach((sc) => {
      if (sc < 40) scoreRanges[0].count += 1;
      else if (sc < 60) scoreRanges[1].count += 1;
      else if (sc < 80) scoreRanges[2].count += 1;
      else scoreRanges[3].count += 1;
    });

    const scoreDistribution = scoreRanges.map((r) => ({
      ...r,
      percentage: completedScores.length > 0 ? round((r.count / completedScores.length) * 100) : 0,
    }));

    // ── 4. Weak Areas & Skill Gap Analysis ──
    const weaknessTally = new Map();
    const competencyBucketsTally = {};
    Object.keys(COMPETENCY_LABELS).forEach((k) => {
      competencyBucketsTally[k] = { scores: [], count: 0 };
    });

    completedSessions.forEach((s) => {
      const weaknesses = s.resultsSummary?.weaknesses || [];
      weaknesses.forEach((w) => {
        const clean = String(w).trim();
        if (clean) weaknessTally.set(clean, (weaknessTally.get(clean) || 0) + 1);
      });

      const compScores = s.resultsSummary?.competencyScores || {};
      Object.keys(competencyBucketsTally).forEach((k) => {
        if (typeof compScores[k] === "number" && compScores[k] > 0) {
          competencyBucketsTally[k].scores.push(compScores[k]);
          competencyBucketsTally[k].count += 1;
        }
      });
    });

    const commonWeakAreas = [...weaknessTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({
        label,
        count,
        percentage: completedSessions.length > 0 ? round((count / completedSessions.length) * 100) : 0,
      }));

    const competencyOverview = Object.entries(competencyBucketsTally).map(([key, data]) => ({
      key,
      label: COMPETENCY_LABELS[key] || key,
      averageScore: round(mean(data.scores)),
      evaluatedCount: data.count,
    }));

    // ── 5. Role, Technology Stack & Interview Type Breakdowns ──
    const roleMap = new Map();
    const techMap = new Map();
    const typeMap = new Map();
    const companyMap = new Map();

    allSessions.forEach((s) => {
      const isCompleted = (s.interviewState === "COMPLETED" || s.interviewState === "EVALUATED") && s.resultsSummary;
      const score = isCompleted ? s.resultsSummary.score : null;
      const readiness = isCompleted ? s.resultsSummary.readinessScore : null;

      // Role Breakdown
      const roleName = s.role?.trim() || "General";
      if (!roleMap.has(roleName)) {
        roleMap.set(roleName, { role: roleName, total: 0, completed: 0, scores: [], readiness: [] });
      }
      const rEntry = roleMap.get(roleName);
      rEntry.total += 1;
      if (isCompleted) {
        rEntry.completed += 1;
        if (score != null) rEntry.scores.push(score);
        if (readiness != null) rEntry.readiness.push(readiness);
      }

      // Tech Stack Breakdown
      const stack = Array.isArray(s.techStack) ? s.techStack : [];
      stack.forEach((t) => {
        const cleanT = String(t).trim();
        if (!cleanT) return;
        if (!techMap.has(cleanT)) techMap.set(cleanT, { technology: cleanT, count: 0, scores: [] });
        const tEntry = techMap.get(cleanT);
        tEntry.count += 1;
        if (score != null) tEntry.scores.push(score);
      });

      // Interview Type Breakdown
      const itypes = Array.isArray(s.interviewTypes) && s.interviewTypes.length ? s.interviewTypes : [s.interviewType || "technical"];
      itypes.forEach((it) => {
        const cleanIt = String(it).trim().toLowerCase();
        if (!typeMap.has(cleanIt)) typeMap.set(cleanIt, { type: cleanIt, count: 0, completed: 0, scores: [] });
        const itEntry = typeMap.get(cleanIt);
        itEntry.count += 1;
        if (isCompleted) {
          itEntry.completed += 1;
          if (score != null) itEntry.scores.push(score);
        }
      });

      // Company Breakdown
      if (s.company && s.company.trim()) {
        const cName = s.company.trim();
        if (!companyMap.has(cName)) companyMap.set(cName, { company: cName, count: 0, scores: [] });
        const cEntry = companyMap.get(cName);
        cEntry.count += 1;
        if (score != null) cEntry.scores.push(score);
      }
    });

    const roleBreakdown = [...roleMap.values()]
      .sort((a, b) => b.total - a.total)
      .map((r) => ({
        role: r.role,
        totalInterviews: r.total,
        completedInterviews: r.completed,
        completionRate: r.total > 0 ? round((r.completed / r.total) * 100) : 0,
        averageScore: round(mean(r.scores)),
        averageReadiness: round(mean(r.readiness)),
      }));

    const techStackBreakdown = [...techMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((t) => ({
        technology: t.technology,
        count: t.count,
        averageScore: round(mean(t.scores)),
      }));

    const interviewTypeBreakdown = [...typeMap.values()]
      .sort((a, b) => b.count - a.count)
      .map((it) => ({
        type: it.type,
        count: it.count,
        completed: it.completed,
        completionRate: it.count > 0 ? round((it.completed / it.count) * 100) : 0,
        averageScore: round(mean(it.scores)),
      }));

    const companyBreakdown = [...companyMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((c) => ({
        company: c.company,
        count: c.count,
        averageScore: round(mean(c.scores)),
      }));

    // ── 6. Filterable & Paginated Student Interviews Table ──
    let filteredSessions = allSessions;

    if (role && role !== "ALL") {
      filteredSessions = filteredSessions.filter((s) => s.role === role);
    }

    if (status && status !== "ALL") {
      filteredSessions = filteredSessions.filter((s) => {
        if (status === "COMPLETED") return s.interviewState === "COMPLETED" || s.interviewState === "EVALUATED";
        if (status === "IN_PROGRESS") return ["IN_PROGRESS", "PROCESSING_ANSWER", "WAITING_FOR_NEXT_QUESTION", "EVALUATING"].includes(s.interviewState);
        if (status === "ABANDONED") return ["CANCELLED", "EXPIRED", "CREATED", "READY"].includes(s.interviewState);
        return s.interviewState === status;
      });
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredSessions = filteredSessions.filter((s) => {
        const studentName = this.fullName(s.userId).toLowerCase();
        const studentEmail = (s.userId?.email || "").toLowerCase();
        const sessionRole = (s.role || "").toLowerCase();
        const sessionCompany = (s.company || "").toLowerCase();
        return (
          studentName.includes(q) ||
          studentEmail.includes(q) ||
          sessionRole.includes(q) ||
          sessionCompany.includes(q) ||
          s.interviewId.toLowerCase().includes(q)
        );
      });
    }

    const totalFiltered = filteredSessions.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const totalPages = Math.ceil(totalFiltered / limitNum) || 1;
    const paginatedSessions = filteredSessions.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const interviewsTable = paginatedSessions.map((s) => ({
      sessionId: s.interviewId,
      interviewId: s.interviewId,
      studentId: s.userId?._id?.toString() || "",
      studentName: this.fullName(s.userId),
      studentEmail: s.userId?.email || "",
      role: s.role,
      company: s.company || "",
      interviewType: s.interviewType || "CUSTOM",
      interviewTypes: s.interviewTypes || ["technical"],
      techStack: s.techStack || [],
      questionCount: s.questionCount || 0,
      duration: s.duration || 30,
      score: s.resultsSummary?.score ?? null,
      readinessScore: s.resultsSummary?.readinessScore ?? null,
      status: s.interviewState,
      date: s.endTime || s.createdAt,
      createdAt: s.createdAt,
    }));

    return {
      overview: {
        totalInterviews,
        completedInterviews: completedSessions.length,
        inProgressInterviews: inProgressSessions.length,
        abandonedInterviews: abandonedSessions.length,
        averageScore,
        averageReadiness,
        totalStudentsPracticed,
        totalStudents,
        completionRate,
      },
      trends,
      scoreDistribution,
      weakAreas: commonWeakAreas,
      competencies: competencyOverview,
      roleBreakdown,
      techStackBreakdown,
      interviewTypeBreakdown,
      companyBreakdown,
      table: {
        data: interviewsTable,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalFiltered,
          totalPages,
        },
      },
    };
  }
}

export const interviewAdminAnalyticsService = new InterviewAdminAnalyticsService();
export default interviewAdminAnalyticsService;
