import { generateStudentReportService } from "./studentReport.service.js";

export const generateStudentReport = async (req, res, next) => {
  try {
    const format = req.query.format?.toLowerCase().trim();
    const studentId = req.user?._id;

    // Validate format
    if (!format || !["pdf", "excel"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Invalid format. Use pdf or excel",
      });
    }

    // Call service
    const fileBuffer = await generateStudentReportService({
      studentId,
      format,
    });

    // If no data found
    if (!fileBuffer) {
      return res.status(404).json({
        success: false,
        message: "No report data available for this student",
      });
    }

    // Set headers
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=student-results.${
        format === "pdf" ? "pdf" : "xlsx"
      }`
    );

    res.setHeader(
      "Content-Type",
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(fileBuffer);
  } catch (error) {
    console.error("Error generating student report:", error);
    next(error);
  }
};
