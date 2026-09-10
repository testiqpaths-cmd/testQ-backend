import { interviewResultsService } from "../services/interview-results.service.js";
import {
  generateInterviewPDF,
  generateInterviewExcel,
} from "./interview-report.generator.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Builds a downloadable report for one completed interview.
 * Reuses interviewResultsService so the file and the on-screen results
 * page are always the same numbers (both read the cached resultsSummary).
 *
 * @returns {Promise<{ buffer: Buffer, filename: string, contentType: string }>}
 */
export const generateInterviewReport = async ({ sessionId, user, format }) => {
  const fmt = String(format || "").toLowerCase().trim();
  if (!["pdf", "excel"].includes(fmt)) {
    throw new ApiError(400, "Invalid format. Use pdf or excel.");
  }

  // Throws 400 if the interview hasn't reached a terminal state, 403/404
  // on ownership — same guard the results endpoint uses.
  const results = await interviewResultsService.getInterviewResults(sessionId, user);

  const buffer =
    fmt === "pdf"
      ? await generateInterviewPDF(results)
      : Buffer.from(await generateInterviewExcel(results));

  const safeId = String(results.id || sessionId).replace(/[^a-zA-Z0-9_-]/g, "");
  return {
    buffer,
    filename: `ai-interview-${safeId}.${fmt === "pdf" ? "pdf" : "xlsx"}`,
    contentType: CONTENT_TYPES[fmt],
  };
};

export default { generateInterviewReport };
