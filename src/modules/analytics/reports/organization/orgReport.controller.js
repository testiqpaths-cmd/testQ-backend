import { generateOrgReportService } from "./orgReport.service.js";

export const generateOrgReport = async (req, res, next) => {
  try {
    // ✅ Extract format and orgId
    const format = req.query.format?.toLowerCase().trim();
    const orgId = req.params.orgId; // comes from route param

    // ✅ Validate format
    if (!format || !["pdf", "excel"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Invalid format. Use pdf or excel",
      });
    }

    // ✅ Call service
    const fileBuffer = await generateOrgReportService({ orgId, format });

    // ✅ Handle no data case
    if (!fileBuffer) {
      return res.status(404).json({
        success: false,
        message: "No report data available for this organization",
      });
    }

    // ✅ Set headers for file download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=organization-report.${format === "pdf" ? "pdf" : "xlsx"}`
    );

    res.setHeader(
      "Content-Type",
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    // ✅ Send file with 200 OK
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Error generating org report:", error);
    next(error);
  }
};
