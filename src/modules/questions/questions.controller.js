// modules/questions/questions.controller.js
import {asyncHandler} from "../../common/utils/asyncHandler.js";
import * as service from "./questions.service.js";
import XLSX from "xlsx";

export const createQuestion = asyncHandler(async (req, res) => {
  const question = await service.createQuestionService(req.body);
  res.status(201).json({ success: true, data: question });
});



export const updateQuestion = asyncHandler(async (req, res) => {
  const question = await service.updateQuestionService(
    req.params.id,
    req.body
  );
  res.json({ success: true, data: question });
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  await service.deleteQuestionService(req.params.id);
  res.json({ success: true, message: "Question deleted" });
});

const parseOptions = (value) => {
  if (!value) return [];

  // supports: "A|B|C|D" and also "A, B, C, D"
  const str = String(value).trim();
  const parts = str.includes("|") ? str.split("|") : str.split(",");

  return parts.map((x) => x.trim()).filter(Boolean); // removes empty strings
};

export const uploadQuestionsExcel = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({
      success: false,
      message: "Excel file is required (field name: file)",
      errors: null,
    });
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const questions = rows.map((row, idx) => ({
    __row: idx + 2,
    topic: String(row.topic || "").trim(),
    subTopic: String(row.subTopic || "").trim(),
    questionText: String(row.questionText || "").trim(),
    type: String(row.type || "").trim(),
    options: parseOptions(row.options),
    correctAnswer: String(row.correctAnswer || "").trim(),
    marks: Number(row.marks),
    difficulty: String(row.difficulty || "").trim(),
  }));

  console.log("📄 Sheet:", sheetName);
  console.log("🧾 First 3 mapped questions:", questions.slice(0, 3));

  // ✅ no auth → no user passed
  await service.bulkUploadQuestionsService(questions);

  res.json({
    success: true,
    message: `${questions.length} questions uploaded`,
  });
});
