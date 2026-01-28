// modules/questions/questions.controller.js
import {asyncHandler} from "../../common/utils/asyncHandler.js";
import * as service from "./questions.service.js";
import XLSX from "xlsx";

export const createQuestion = asyncHandler(async (req, res) => {
  const question = await service.createQuestionService(req.body, req.user);
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

export const uploadQuestionsExcel = asyncHandler(async (req, res) => {
  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const questions = rows.map((row) => ({
    topic: row.topic,
    subTopic: row.subTopic,
    questionText: row.questionText,
    type: row.type,
    options: row.options ? row.options.split("|") : [],
    correctAnswer: row.correctAnswer,
    marks: Number(row.marks),
    difficulty: row.difficulty,
  }));

  await service.bulkUploadQuestionsService(questions, req.user);

  res.json({
    success: true,
    message: `${questions.length} questions uploaded`,
  });
});
