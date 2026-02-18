import ExcelJS from "exceljs";

export const generateExcel = async (results) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Results");

  // Define columns with headers and widths
  sheet.columns = [
    { header: "Test Name", key: "testName", width: 30 },
    { header: "Score", key: "score", width: 15 },
    { header: "Percentage", key: "percentage", width: 15 },
    { header: "Result", key: "result", width: 15 },
    { header: "Date", key: "date", width: 20 },
  ];

  // Add rows
  results.forEach((r) => {
  sheet.addRow({
    testName: r.testId?.name || r.testId?.title || "N/A",
    score: `${r.totalScore ?? 0}/${r.maxScore ?? 0}`,
    percentage: r.percentage ?? 0,
    result: r.resultStatus || "N/A",
    date: r.createdAt
      ? new Date(r.createdAt).toLocaleDateString()
      : "N/A",
    });
  });

  // Return buffer for download
  return await workbook.xlsx.writeBuffer();
};
