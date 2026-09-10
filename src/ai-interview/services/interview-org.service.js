import mongoose from "mongoose";
import User from "../../models/user.model.js";
import { InterviewSession } from "../schemas/interview-session.schema.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

const round = (v) => Math.round(Number.isFinite(v) ? v : 0);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export class InterviewOrgService {
  /**
   * Resolves which students an org/admin user is allowed to see AI Interview
   * data for. ORGANIZATION -> their own org's students. IQPATH_ADMIN -> all
   * students, optionally narrowed by ?organizationId=.
   */
  async resolveStudentIds(user, { organizationId } = {}) {
    if (user.role === "IQPATH_ADMIN") {
      const filter = { role: "STUDENT", isDeleted: { $ne: 1 } };
      if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
        filter.organizationId = organizationId;
      }
      const students = await User.find(filter).select("_id firstName lastName email").lean();
      return students;
    }

    if (user.role === "ORGANIZATION") {
      if (!user.organizationId) {
        throw new ApiError(403, "This organization account is not linked to an organization.");
      }
      const students = await User.find({
        role: "STUDENT",
        organizationId: user.organizationId,
        isDeleted: { $ne: 1 },
      })
        .select("_id firstName lastName email")
        .lean();
      return students;
    }

    throw new ApiError(403, "Only organization and admin accounts can view this data.");
  }

  fullName(u) {
    return [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown";
  }

  /**
   * GET /ai-interview/org/overview
   * Aggregate stats + a recent-interviews table across the caller's
   * in-scope students. Read-only.
   */
  async getOrgOverview(user, query = {}) {
    const students = await this.resolveStudentIds(user, query);
    const byId = new Map(students.map((s) => [s._id.toString(), s]));
    const studentIds = students.map((s) => s._id);

    if (studentIds.length === 0) {
      return {
        stats: {
          totalInterviews: 0,
          completedInterviews: 0,
          activeStudents: 0,
          totalStudents: 0,
          averageScore: 0,
          averageReadiness: 0,
        },
        commonWeakAreas: [],
        recentInterviews: [],
      };
    }

    const sessions = await InterviewSession.find({ userId: { $in: studentIds } })
      .sort({ createdAt: -1 })
      .select("interviewId userId role company interviewState questionCount createdAt endTime resultsSummary")
      .lean();

    const completed = sessions.filter((s) => s.interviewState === "COMPLETED" && s.resultsSummary);
    const scores = completed.map((s) => s.resultsSummary.score ?? 0);
    const readiness = completed.map((s) => s.resultsSummary.readinessScore ?? 0);

    const weakTally = new Map();
    for (const s of completed) {
      for (const w of s.resultsSummary.weaknesses || []) {
        weakTally.set(w, (weakTally.get(w) || 0) + 1);
      }
    }
    const commonWeakAreas = [...weakTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));

    const recentInterviews = sessions.slice(0, 15).map((s) => {
      const student = byId.get(s.userId.toString());
      return {
        interviewId: s.interviewId,
        sessionId: s.interviewId,
        studentId: s.userId.toString(),
        studentName: this.fullName(student),
        studentEmail: student?.email || "",
        role: s.role,
        company: s.company || "",
        questionCount: s.questionCount || 0,
        score: s.resultsSummary?.score ?? null,
        readinessScore: s.resultsSummary?.readinessScore ?? null,
        status: s.interviewState,
        date: s.endTime || s.createdAt,
      };
    });

    return {
      stats: {
        totalInterviews: sessions.length,
        completedInterviews: completed.length,
        activeStudents: new Set(sessions.map((s) => s.userId.toString())).size,
        totalStudents: studentIds.length,
        averageScore: round(mean(scores)),
        averageReadiness: round(mean(readiness)),
      },
      commonWeakAreas,
      recentInterviews,
    };
  }

  /**
   * GET /ai-interview/org/students/:studentId
   * One student's interview list — org-scoped so an ORGANIZATION user can
   * only pull their own students.
   */
  async getStudentInterviews(user, studentId) {
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      throw new ApiError(400, "Invalid student id.");
    }

    const students = await this.resolveStudentIds(user);
    const inScope = students.some((s) => s._id.toString() === studentId.toString());
    if (!inScope) {
      throw new ApiError(403, "That student is not in your organization.");
    }

    const student = students.find((s) => s._id.toString() === studentId.toString());
    const sessions = await InterviewSession.find({ userId: studentId })
      .sort({ createdAt: -1 })
      .select("interviewId role company difficulty duration questionCount interviewTypes interviewState createdAt endTime resultsSummary")
      .lean();

    return {
      student: {
        id: studentId.toString(),
        name: this.fullName(student),
        email: student?.email || "",
      },
      items: sessions.map((s) => ({
        id: s.interviewId,
        sessionId: s.interviewId,
        role: s.role,
        company: s.company || "",
        difficulty: s.difficulty,
        duration: s.duration,
        questionCount: s.questionCount,
        interviewTypes: s.interviewTypes,
        status: s.interviewState,
        score: s.resultsSummary?.score ?? null,
        readinessScore: s.resultsSummary?.readinessScore ?? null,
        date: s.endTime || s.createdAt,
      })),
      total: sessions.length,
    };
  }
}

export const interviewOrgService = new InterviewOrgService();
export default interviewOrgService;
