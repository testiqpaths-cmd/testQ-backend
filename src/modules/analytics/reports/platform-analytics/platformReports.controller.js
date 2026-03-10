import { exportPlatformReports } from "./platformReports.service.js";

export const generatePlatformReport = async (req, res) => {
  try {
    const format = req.query.format || "pdf";
    const fileBuffer = await exportPlatformReports(format);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=platform-reports.${format === "excel" ? "xlsx" : "pdf"}`
    );
    res.setHeader(
      "Content-Type",
      format === "excel"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/pdf"
    );

    // ✅ Use res.end for binary buffers
    return res.status(200).end(fileBuffer);
  } catch (err) {
    console.error("Error generating platform report:", err);
    res.status(500).json({
      success: false,
      message: "Failed to generate platform report",
      error: err.message,
    });
  }
};
