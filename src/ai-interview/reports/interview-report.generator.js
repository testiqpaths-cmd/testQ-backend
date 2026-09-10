import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

const COMPETENCY_LABELS = {
  technicalSkills: "Technical Skills",
  problemSolving: "Problem Solving",
  communication: "Communication",
  systemDesign: "System Design",
  projects: "Projects",
  behavioral: "Behavioral",
  confidence: "Confidence",
};

const fmtDate = (value) => {
  if (!value) return "N/A";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "N/A" : d.toLocaleString();
};

const asList = (arr) => (Array.isArray(arr) && arr.length ? arr : []);

/**
 * A candidate-facing PDF of one completed interview's scored results.
 * Consumes the exact object interviewResultsService.getInterviewResults
 * returns. Resolves to a Buffer.
 */
export const generateInterviewPDF = (results) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 45, size: "A4" });
      const buffers = [];
      doc.on("data", (c) => buffers.push(c));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const r = results || {};

      doc.fontSize(20).fillColor("#0B3B78").text("AI Interview Report", { align: "center" });
      doc.moveDown(0.2);
      doc
        .fontSize(10)
        .fillColor("#6B7280")
        .text(`Generated ${fmtDate(new Date())}`, { align: "center" });
      doc.moveDown(1);

      doc.fontSize(11).fillColor("#111827");
      doc.text(`Role: ${r.role || "N/A"}${r.company ? `  •  Target: ${r.company}` : ""}`);
      doc.text(`Experience: ${r.experience || "N/A"}`);
      doc.text(
        `Interview types: ${asList(r.interviewTypes).join(", ") || "N/A"}  •  Difficulty: ${r.difficulty || "N/A"}`
      );
      doc.text(`Questions answered: ${r.questionCount ?? asList(r.questions).length}`);
      doc.text(`Date: ${fmtDate(r.date)}`);
      doc.moveDown(0.8);

      doc.fontSize(14).fillColor("#0B3B78").text("Overall");
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor("#111827");
      doc.text(`Score: ${r.score ?? 0} / 100`);
      doc.text(`Interview readiness: ${r.readinessScore ?? 0} / 100`);
      doc.moveDown(0.6);

      if (r.overallFeedback) {
        doc.fontSize(11).fillColor("#374151").text(String(r.overallFeedback), { align: "left" });
        doc.moveDown(0.8);
      }

      const comp = r.competencyScores || {};
      const compKeys = Object.keys(COMPETENCY_LABELS).filter((k) => comp[k] != null);
      if (compKeys.length) {
        doc.fontSize(14).fillColor("#0B3B78").text("Competency breakdown");
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#111827");
        compKeys.forEach((k) => doc.text(`${COMPETENCY_LABELS[k]}: ${comp[k]} / 100`));
        doc.moveDown(0.8);
      }

      const strengths = asList(r.strengths);
      const weaknesses = asList(r.weaknesses);
      if (strengths.length || weaknesses.length) {
        doc.fontSize(14).fillColor("#0B3B78").text("Strengths & focus areas");
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#111827");
        if (strengths.length) doc.text(`Strengths: ${strengths.join(", ")}`);
        if (weaknesses.length) doc.text(`Focus areas: ${weaknesses.join(", ")}`);
        doc.moveDown(0.8);
      }

      const questions = asList(r.questions);
      if (questions.length) {
        doc.fontSize(14).fillColor("#0B3B78").text("Question-by-question");
        doc.moveDown(0.4);

        questions.forEach((q, i) => {
          if (doc.y > 720) doc.addPage();
          doc.fontSize(12).fillColor("#111827").text(`Q${i + 1}. ${q.questionText || ""}`);
          doc.fontSize(10).fillColor("#6B7280").text(
            `Section: ${q.section || "technical"}   •   Score: ${q.score ?? 0} / 100`
          );
          doc.moveDown(0.2);
          doc.fontSize(10).fillColor("#374151");
          doc.text(`Your answer: ${q.yourAnswer || "No response recorded."}`);
          if (q.whatWasGood) doc.text(`What was good: ${q.whatWasGood}`);
          if (q.whatToImprove) doc.text(`What to improve: ${q.whatToImprove}`);
          if (q.idealAnswer) doc.text(`Ideal answer: ${q.idealAnswer}`);
          doc.moveDown(0.7);
        });
      }

      const practice = asList(r.recommendedPractice);
      if (practice.length) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(14).fillColor("#0B3B78").text("Recommended practice");
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#111827");
        practice.forEach((p) => doc.text(`• ${p}`));
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });

/**
 * The same results as a two-sheet .xlsx workbook (summary + per-question).
 * Resolves to a Buffer.
 */
export const generateInterviewExcel = async (results) => {
  const r = results || {};
  const wb = new ExcelJS.Workbook();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 70 },
  ];
  const comp = r.competencyScores || {};
  const summaryRows = [
    ["Role", r.role || "N/A"],
    ["Target company", r.company || "N/A"],
    ["Experience", r.experience || "N/A"],
    ["Interview types", asList(r.interviewTypes).join(", ") || "N/A"],
    ["Difficulty", r.difficulty || "N/A"],
    ["Questions answered", r.questionCount ?? asList(r.questions).length],
    ["Date", fmtDate(r.date)],
    ["Score (/100)", r.score ?? 0],
    ["Interview readiness (/100)", r.readinessScore ?? 0],
    ["Strengths", asList(r.strengths).join(", ") || "N/A"],
    ["Focus areas", asList(r.weaknesses).join(", ") || "N/A"],
    ["Recommended practice", asList(r.recommendedPractice).join(", ") || "N/A"],
    ["Overall feedback", r.overallFeedback || "N/A"],
  ];
  Object.keys(COMPETENCY_LABELS).forEach((k) => {
    if (comp[k] != null) summaryRows.push([COMPETENCY_LABELS[k], comp[k]]);
  });
  summaryRows.forEach(([field, value]) => summary.addRow({ field, value }));
  summary.getRow(1).font = { bold: true };

  const qSheet = wb.addWorksheet("Questions");
  qSheet.columns = [
    { header: "#", key: "num", width: 5 },
    { header: "Section", key: "section", width: 14 },
    { header: "Question", key: "question", width: 55 },
    { header: "Score", key: "score", width: 8 },
    { header: "Your answer", key: "answer", width: 55 },
    { header: "What was good", key: "good", width: 40 },
    { header: "What to improve", key: "improve", width: 40 },
    { header: "Ideal answer", key: "ideal", width: 55 },
  ];
  asList(r.questions).forEach((q, i) => {
    qSheet.addRow({
      num: i + 1,
      section: q.section || "technical",
      question: q.questionText || "",
      score: q.score ?? 0,
      answer: q.yourAnswer || "No response recorded.",
      good: q.whatWasGood || "",
      improve: q.whatToImprove || "",
      ideal: q.idealAnswer || "",
    });
  });
  qSheet.getRow(1).font = { bold: true };

  return wb.xlsx.writeBuffer();
};

export default { generateInterviewPDF, generateInterviewExcel };
