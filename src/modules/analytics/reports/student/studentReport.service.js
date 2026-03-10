import { getStudentResults } from "../../repository/studentReport.repository.js";
import { generatePDF } from "../generators/pdf.generator.js";
import { generateExcel } from "../generators/excel.generator.js";

export const generateStudentReportService = async ({ studentId, format }) => {
  // Fetch results
  const results = await getStudentResults(studentId);

  // If no results found, return null (NOT throw error)
  if (!results || results.length === 0) {
    return null;
  }

  // Generate report
  switch (format) {
    case "pdf":
      return await generatePDF(results);

    case "excel":
      return await generateExcel(results);

    default:
      return null;
  }
};
