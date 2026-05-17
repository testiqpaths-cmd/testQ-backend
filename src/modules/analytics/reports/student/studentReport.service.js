import { getResultsForUser } from "../../repository/studentReport.repository.js";
import { generateStudentPDF } from "../generators/pdf.generator.js";
import { generateExcel } from "../generators/excel.generator.js";

export const generateStudentReportService = async ({ user, format, resultId }) => {
  // Fetch results
  const results = await getResultsForUser(user, { resultId });

  // If no results found, return null (NOT throw error)
  if (!results || results.length === 0) {
    return null;
  }

  // Generate report
  switch (format) {
    case "pdf":
      return await generateStudentPDF(results, { includeSingleTestHeader: Boolean(resultId) });

    case "excel":
      return await generateExcel(results);

    default:
      return null;
  }
};
