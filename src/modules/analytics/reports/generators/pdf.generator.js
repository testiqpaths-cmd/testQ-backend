import PDFDocument from "pdfkit";

export const generatePDF = (results) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      // ===== TITLE =====
      doc.fontSize(18).text("Analytics Report", { align: "center" }).moveDown(2);

      if (!results) {
        doc.fontSize(12).text("No results available.");
        doc.end();
        return;
      }

      // Normalize results into array
      const rows = Array.isArray(results) ? results : [results];

      rows.forEach((r, index) => {
        doc.fontSize(14).text(`Entry #${index + 1}`, { underline: true }).moveDown(0.5);
        doc.fontSize(12);

        // Handle student/org attempts
        if (r.testId) {
          doc.text(`Test: ${r.testId?.name || r.testId?.title || "N/A"}`);
          doc.text(`Score: ${(r.totalScore ?? 0)}/${(r.maxScore ?? 0)}`);
          doc.text(`Percentage: ${r.percentage != null ? Number(r.percentage).toFixed(2) : "0"}%`);
          doc.text(`Result: ${r.resultStatus || "N/A"}`);
          doc.text(`Date: ${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "N/A"}`);
        } else {
          // Handle platform stats
          doc.text(`Total Users: ${r.totalUsers ?? 0}`);
          doc.text(`Total Organizations: ${r.totalOrganizations ?? 0}`);
          doc.text(`Total Attempts: ${r.totalAttempts ?? 0}`);
          doc.text(`Average Score: ${r.averageScore != null ? Number(r.averageScore).toFixed(2) : "0"}%`);
          doc.text(`Generated At: ${r.generatedAt ? new Date(r.generatedAt).toLocaleDateString() : "N/A"}`);
        }

        doc.moveDown(1.5);
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};
