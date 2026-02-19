import { getPlatformStats } from "../../repository/platformReports.repository.js";
import { generatePDF } from "../generators/pdf.generator.js";
import { generateExcel } from "../generators/excel.generator.js";

// Fetch analytics data
export const fetchPlatformAnalytics = async () => {
  return await getPlatformStats();
};

// Export report
export const exportPlatformReports = async (format = "pdf") => {
  const data = await fetchPlatformAnalytics();

  // Ensure array format for generators
  const results = Array.isArray(data) ? data : [data];

  if (format === "excel") {
    return generateExcel(results); // ✅ FIXED
  }

  return generatePDF(results); // ✅ FIXED
};
