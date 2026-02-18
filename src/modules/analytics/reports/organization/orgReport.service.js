import { getOrgResults } from "../../repository/orgReport.repository.js";
import { generatePDF } from "../generators/pdf.generator.js";
import { generateExcel } from "../generators/excel.generator.js";

export const generateOrgReportService = async ({ orgId, format }) => {
  // ✅ Fetch all results for the organization
  const results = await getOrgResults(orgId);

  // ✅ Handle case where no students or attempts exist
  if (!results || results.length === 0) {
    return null; // controller should return 404 or a friendly message
  }

  // ✅ Generate report based on requested format
  switch (format) {
    case "pdf":
      return await generatePDF(results);
    case "excel":
      return await generateExcel(results);
    default:
      // ✅ Invalid format handling
      throw new Error("Invalid format. Supported formats: pdf, excel");
  }
};
