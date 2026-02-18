import PDFDocument from "pdfkit";

export const generatePDF = (results) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: "A4",
      });

      const buffers = [];

      // Collect PDF chunks
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      // ===== TITLE =====
      doc
        .fontSize(18)
        .text("Student Results Report", { align: "center" })
        .moveDown(2);

      if (!results || results.length === 0) {
        doc.fontSize(12).text("No results available.");
        doc.end();
        return;
      }

      // ===== LOOP THROUGH RESULTS =====
      results.forEach((r, index) => {
        doc
          .fontSize(14)
          .text(`Attempt #${index + 1}`, { underline: true })
          .moveDown(0.5);

        doc.fontSize(12);

        doc.text(
          `Test: ${r.testId?.name || r.testId?.title || "N/A"}`
        );

        doc.text(
          `Score: ${(r.totalScore ?? 0)}/${(r.maxScore ?? 0)}`
        );

        doc.text(
          `Percentage: ${
            r.percentage != null
              ? Number(r.percentage).toFixed(2)
              : "0"
          }%`
        );

        doc.text(
          `Result: ${r.resultStatus || "N/A"}`
        );

        doc.text(
          `Date: ${
            r.createdAt
              ? new Date(r.createdAt).toLocaleDateString()
              : "N/A"
          }`
        );

        doc.moveDown(1.5);
      });

      // Finalize PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};
