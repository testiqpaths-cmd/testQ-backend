// modules/questions/questions.controller.js
import {asyncHandler} from "../../common/utils/asyncHandler.js";
import * as service from "./questions.service.js";
import XLSX from "xlsx";
import Question from "../../models/question.model.js";
import mongoose from "mongoose";
import logger from "../../config/logger.js";


export const createQuestion = asyncHandler(async (req, res) => {
  
  const payload = {
    ...req.body,
    createdBy: req.user._id,
   
  };
  const question = await service.createQuestionService(payload);

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
  try{
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
    subjectId: String(row.subjectId || "").trim(),
    topicId: String(row.topicId || "").trim(),
    questionText: String(row.questionText || "").trim(),
    type: String(row.type || "").trim(),
    options: parseOptions(row.options),
    correctAnswer: String(row.correctAnswer || "").trim(),
    marks: Number(row.marks),
    difficulty: String(row.difficulty || "").trim(),
  }));

  // console.log("📄 Sheet:", sheetName);
  // console.log("🧾 First 3 mapped questions:", questions.slice(0, 3));

  // ✅ no auth → no user passed
  // console.log("User in request:", req.user);
  await service.bulkUploadQuestionsService(questions,req.user);
  // console.log("Bulk upload complete");

  res.json({
    success: true,
    message: `${questions.length} questions uploaded`,
  });
}catch(err){
  logger.error(`Error during bulk upload: ${err.message}`);
  res.status(500).json({
    success: false,
    message: "An error occurred during bulk upload",
    errors: err.message,
  });
}
});

export const getAllQuestionsController = async (req, res) => {
  try {
    const {
      subjectId,
      topicId,
      type,
      difficulty,
      organizationId,
      page = 1,
      limit,
      quantity,
      sort = "-createdAt",
    } = req.query;

    // Build filters object - only add if value exists
    const filters = {};
    if (subjectId) filters.subjectId = subjectId;
    if (topicId) filters.topicId = topicId;
    if (type) filters.type = type;
    if (difficulty) filters.difficulty = difficulty;
    if (organizationId) filters.organizationId = organizationId;

    const pageNum = Math.max(1, Number(page));
    const resolvedLimit = limit ?? quantity ?? 10;
    const limitNum = Math.min(100, Math.max(1, Number(resolvedLimit)));

    const [items, total] = await Promise.all([
      Question.find(filters)
        .populate("subjectId", "name description")
        .populate("topicId", "name description")
        .populate("createdBy", "name email")
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Question.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      message: "Questions fetched",
      data: items,
      filters: filters, // Return applied filters for clarity
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch questions",
    });
  }
};

export const getQuestionsByUserIdController = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const questions = await Question.find({ createdBy: userId })
      .populate("subjectId", "name description")
      .populate("topicId", "name description")
      .sort("-createdAt");

    return res.status(200).json({
      success: true,
      message: "User questions fetched",
      data: questions,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch user questions",
    });
  }
};

export const getQuestionByIdController = async (req, res) => {
  try {
    const { questionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: "Invalid questionId" });
    }

    const question = await Question.findById(questionId)
      .populate("subjectId", "name description")
      .populate("topicId", "name description")
      .populate("createdBy", "name email");

    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Question fetched",
      data: question,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch question",
    });
  }
};

// Get questions by subject ID
export const getQuestionsBySubjectController = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { page = 1, limit = 10, sort = "-createdAt", type, difficulty } = req.query;

    if (!mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.status(400).json({ success: false, message: "Invalid subjectId" });
    }

    const filters = { subjectId };
    if (type) filters.type = type;
    if (difficulty) filters.difficulty = difficulty;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [items, total] = await Promise.all([
      Question.find(filters)
        .populate("subjectId", "name description")
        .populate("topicId", "name description")
        .populate("createdBy", "name email")
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Question.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      message: "Questions by subject fetched",
      data: items,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch questions by subject",
    });
  }
};

// Get questions by topic ID
export const getQuestionsByTopicController = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { page = 1, limit = 10, sort = "-createdAt", type, difficulty } = req.query;

    if (!mongoose.Types.ObjectId.isValid(topicId)) {
      return res.status(400).json({ success: false, message: "Invalid topicId" });
    }

    const filters = { topicId };
    if (type) filters.type = type;
    if (difficulty) filters.difficulty = difficulty;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [items, total] = await Promise.all([
      Question.find(filters)
        .populate("subjectId", "name description")
        .populate("topicId", "name description")
        .populate("createdBy", "name email")
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Question.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      message: "Questions by topic fetched",
      data: items,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch questions by topic",
    });
  }
};