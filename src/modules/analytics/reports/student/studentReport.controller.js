import { generateStudentReportService } from "./studentReport.service.js";
import mongoose from "mongoose";

export const generateStudentReport = async (req, res, next) => {
  try {
    const format = req.query.format?.toLowerCase().trim() || "pdf";
    const resultId = req.query.resultId?.toString().trim() || null;
    const studentId = req.user?._id;

    if (resultId && !mongoose.Types.ObjectId.isValid(resultId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resultId",
      });
    }

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
      resultId,
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
      `attachment; filename=${resultId ? "student-test-result" : "student-results"}.${
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
