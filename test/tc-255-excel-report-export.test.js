import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { generateInterviewExcel, generateInterviewPDF } from "../src/ai-interview/reports/interview-report.generator.js";
import { generateInterviewReport } from "../src/ai-interview/reports/interview-report.service.js";
import { interviewResultsService } from "../src/ai-interview/services/interview-results.service.js";
import { aiInterviewController } from "../src/ai-interview/controllers/ai-interview.controller.js";

const MOCK_RESULTS = {
  id: "session-12345",
  role: "Frontend Developer",
  company: "TestQ Technologies",
  experience: "Mid-Level",
  interviewTypes: ["technical"],
  difficulty: "medium",
  questionCount: 3,
  date: "2026-10-22T10:00:00.000Z",
  score: 85,
  readinessScore: 83,
  strengths: ["Strong JavaScript fundamentals", "Clear communication"],
  weaknesses: ["Deepen knowledge in SSR hydration"],
  recommendedPractice: ["Practice React concurrent features"],
  overallFeedback: "Solid technical performance with good reasoning skills.",
  integritySignals: [{ signalType: "tab_switch", label: "Tab switches", count: 1 }],
  competencyScores: {
    technicalSkills: 88,
    problemSolving: 82,
    systemDesign: null, // TC-223 unassessed
    behavioral: null,   // TC-223 unassessed
  },
  questions: [
    {
      turnNumber: 1,
      section: "technical",
      questionText: "Explain the difference between useEffect and useLayoutEffect in React.",
      score: 90,
      yourAnswer: "useEffect runs asynchronously after paint, while useLayoutEffect runs synchronously after DOM mutations.",
      whatWasGood: "Precise distinction regarding browser paint timing.",
      whatToImprove: "Mention potential performance impact of blocking paint.",
      idealAnswer: "useEffect fires after browser paint, useLayoutEffect fires before paint for measurements.",
    },
    {
      turnNumber: 2,
      section: "technical",
      questionText: "What are React Server Components and how do they differ from SSR?",
      score: 80,
      yourAnswer: "RSC execute only on the server and do not ship JS bundle to client.",
      whatWasGood: "Highlighted zero-bundle impact.",
      whatToImprove: "Explain client component boundaries and serialization.",
      idealAnswer: "RSC run exclusively on server, never hydrate on client, and stream serialized JSON.",
    },
    {
      turnNumber: 3,
      section: "technical",
      questionText: "How do you optimize Largest Contentful Paint (LCP)?",
      score: 85,
      yourAnswer: "Preload hero image, optimize TTFB, eliminate render-blocking CSS.",
      whatWasGood: "Good holistic coverage across network and DOM rendering.",
      whatToImprove: "Include Fetch Priority header (`fetchpriority='high'`).",
      idealAnswer: "Preload LCP resource with fetchpriority='high', use modern formats (AVIF/WebP), and serve over CDN.",
    },
  ],
};

test("TC-255: Report Download: Excel report export (format=excel) Suite", async (t) => {
  await t.test("Scenario 1: generateInterviewExcel generates a valid .xlsx buffer with metadata and turns", async () => {
    const rawBuffer = await generateInterviewExcel(MOCK_RESULTS);
    const buffer = Buffer.from(rawBuffer);

    // Verify it is a valid buffer
    assert.ok(Buffer.isBuffer(buffer), "Expected a Buffer");
    assert.ok(buffer.byteLength > 1000, `Buffer size (${buffer.byteLength}) should be non-trivial`);

    // Verify Excel / ZIP file magic header (PK\x03\x04)
    assert.equal(buffer[0], 0x50, "Header byte 0 should be 'P'");
    assert.equal(buffer[1], 0x4b, "Header byte 1 should be 'K'");
    assert.equal(buffer[2], 0x03, "Header byte 2 should be 0x03");
    assert.equal(buffer[3], 0x04, "Header byte 3 should be 0x04");

    // Read back using ExcelJS to verify structure and content
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const summarySheet = workbook.getWorksheet("Summary");
    assert.ok(summarySheet, "Worksheet 'Summary' must exist");

    const questionsSheet = workbook.getWorksheet("Questions");
    assert.ok(questionsSheet, "Worksheet 'Questions' must exist");

    // Check Summary rows
    const summaryData = {};
    summarySheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const field = row.getCell(1).value;
        const val = row.getCell(2).value;
        summaryData[field] = val;
      }
    });

    assert.equal(summaryData["Role"], "Frontend Developer");
    assert.equal(summaryData["Target company"], "TestQ Technologies");
    assert.equal(summaryData["Difficulty"], "medium");
    assert.equal(summaryData["Score (/100)"], 85);
    assert.equal(summaryData["Interview readiness (/100)"], 83);
    assert.equal(summaryData["Technical Skills"], 88);
    assert.equal(summaryData["Problem Solving"], 82);
    // TC-223 check: null competencies should not appear as 0
    assert.equal(summaryData["System Design"], undefined, "Unassessed System Design should be omitted or null, not 0");
    assert.equal(summaryData["Behavioral"], undefined, "Unassessed Behavioral should be omitted or null, not 0");

    // Check Questions rows
    assert.equal(questionsSheet.rowCount, 4, "Should have 1 header row + 3 question rows");
    const q1Row = questionsSheet.getRow(2);
    assert.equal(q1Row.getCell(1).value, 1);
    assert.equal(q1Row.getCell(2).value, "technical");
    assert.match(String(q1Row.getCell(3).value), /useEffect/);
    assert.equal(q1Row.getCell(4).value, 90);
    assert.match(String(q1Row.getCell(5).value), /asynchronously/);
  });

  await t.test("Scenario 2: generateInterviewReport handles format='excel' and format='xlsx'", async () => {
    // Mock getInterviewResults
    const originalGetResults = interviewResultsService.getInterviewResults;
    interviewResultsService.getInterviewResults = async () => MOCK_RESULTS;

    try {
      // 1. Explicit format='excel'
      const excelReport = await generateInterviewReport({
        sessionId: "session-12345",
        user: { _id: "user-1" },
        format: "excel",
      });

      assert.equal(
        excelReport.contentType,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ContentType must match openxmlformats spreadsheet"
      );
      assert.equal(excelReport.filename, "ai-interview-session-12345.xlsx");
      assert.ok(Buffer.isBuffer(excelReport.buffer));

      // 2. Alias format='xlsx'
      const xlsxReport = await generateInterviewReport({
        sessionId: "session-12345",
        user: { _id: "user-1" },
        format: "xlsx",
      });
      assert.equal(xlsxReport.filename, "ai-interview-session-12345.xlsx");

      // 3. format='pdf'
      const pdfReport = await generateInterviewReport({
        sessionId: "session-12345",
        user: { _id: "user-1" },
        format: "pdf",
      });
      assert.equal(pdfReport.contentType, "application/pdf");
      assert.equal(pdfReport.filename, "ai-interview-session-12345.pdf");

      // 4. Default format (undefined) -> defaults to pdf
      const defaultReport = await generateInterviewReport({
        sessionId: "session-12345",
        user: { _id: "user-1" },
      });
      assert.equal(defaultReport.contentType, "application/pdf");

      // 5. Invalid format -> throws 400
      await assert.rejects(
        () =>
          generateInterviewReport({
            sessionId: "session-12345",
            user: { _id: "user-1" },
            format: "doc",
          }),
        (err) => err.statusCode === 400 && /Invalid format/.test(err.message)
      );
    } finally {
      interviewResultsService.getInterviewResults = originalGetResults;
    }
  });

  await t.test("Scenario 3: Controller downloadInterviewReport sets Content-Disposition and Content-Type correctly for format=excel", async () => {
    const originalGetResults = interviewResultsService.getInterviewResults;
    interviewResultsService.getInterviewResults = async () => MOCK_RESULTS;

    try {
      const headers = {};
      let sentBody = null;
      let statusCode = 200;

      const req = {
        params: { id: "session-12345" },
        user: { _id: "user-1" },
        query: { format: "excel" },
      };

      const res = {
        setHeader(name, value) {
          headers[name] = value;
          return this;
        },
        status(code) {
          statusCode = code;
          return this;
        },
        send(body) {
          sentBody = body;
          return this;
        },
      };

      let nextError = null;
      await aiInterviewController.downloadInterviewReport(req, res, (err) => {
        nextError = err;
      });

      assert.equal(nextError, null, "Should not call next with error");
      assert.equal(statusCode, 200);
      assert.equal(
        headers["Content-Type"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      assert.match(headers["Content-Disposition"], /attachment; filename="ai-interview-session-12345\.xlsx"/);
      assert.ok(Buffer.isBuffer(sentBody));
      assert.equal(sentBody[0], 0x50); // 'P'
      assert.equal(sentBody[1], 0x4b); // 'K'
    } finally {
      interviewResultsService.getInterviewResults = originalGetResults;
    }
  });

  await t.test("Scenario 4: Gracefully handles empty / minimal questions in Excel export", async () => {
    const minimalResults = {
      id: "session-minimal",
      role: "Backend Engineer",
      questions: [],
    };

    const buffer = Buffer.from(await generateInterviewExcel(minimalResults));
    assert.ok(buffer.byteLength > 0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const summary = wb.getWorksheet("Summary");
    const questions = wb.getWorksheet("Questions");

    assert.ok(summary);
    assert.ok(questions);
    assert.equal(questions.rowCount, 1, "Should have 1 header row with 0 question rows");
  });
});
