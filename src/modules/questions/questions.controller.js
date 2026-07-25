// modules/questions/questions.controller.js
import { asyncHandler } from "../../common/utils/asyncHandler.js";
import * as service from "./questions.service.js";
import { generateQuestionTemplate } from "./templates/generate-template.js";
import { ApiError } from "../../common/exceptions/ApiError.js";

export const createQuestion = asyncHandler(async (req, res) => {
  const payload = {
    subjectId: req.body.subjectId || req.body.topic,
    topicId: req.body.topicId || req.body.subTopic,
    questionText: req.body.questionText,
    type: req.body.type,
    options: Array.isArray(req.body.options) ? req.body.options : [],
    correctAnswer: req.body.correctAnswer,
    difficulty: req.body.difficulty,
    imageUrl: req.body.imageUrl || null,
    createdBy: req.user._id,
  };

  const question = await service.createQuestionService(payload);
  res.status(201).json({ success: true, data: question });
});

export const updateQuestion = asyncHandler(async (req, res) => {
  const question = await service.updateQuestionService(req.params.id, req.body, req.user);
  res.json({ success: true, data: question });
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  await service.deleteQuestionService(req.params.id, req.user);
  res.json({ success: true, message: "Question deleted" });
});

export const uploadQuestionImage = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new ApiError(400, "Image file is required (field name: image)");
  }

  const url = await service.uploadQuestionImageService(req.file);
  res.status(201).json({ success: true, url });
});

export const uploadQuestionsExcel = asyncHandler(async (req, res) => {
  const result = await service.uploadQuestionsExcelService({
    fileBuffer: req.file?.buffer,
    originalname: req.file?.originalname,
    subjectId: req.body.subjectId,
    subject: req.body.subject,
    topicId: req.body.topicId,
    topic: req.body.topic,
    excelBatchId: req.body.excelBatchId,
    excelBatchName: req.body.excelBatchName,
    user: req.user,
  });

  res.status(result.statusCode).json(result);
});

export const getMyExcelBatchesController = asyncHandler(async (req, res) => {
  const batches = await service.getMyExcelBatchesService(req.user?._id);

  res.json({
    success: true,
    data: batches,
  });
});

export const getQuestionsByExcelBatchController = asyncHandler(async (req, res) => {
  const items = await service.getQuestionsByExcelBatchService({
    userId: req.user?._id,
    batchId: req.params.batchId,
    quantity: req.query.quantity,
    difficulty: req.query.difficulty,
  });

  return res.json({ success: true, data: items });
});

export const getAllQuestionsController = asyncHandler(async (req, res) => {
  const result = await service.getAllQuestionsService(req.query, req.user);

  return res.status(200).json({
    success: true,
    message: "Questions fetched",
    data: result.items,
    filters: result.filters,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: Math.ceil(result.total / result.limit),
    },
  });
});

export const getQuestionsByUserIdController = asyncHandler(async (req, res) => {
  const questions = await service.getQuestionsByUserIdService(req.params.userId);

  return res.status(200).json({
    success: true,
    message: "User questions fetched",
    data: questions,
  });
});

export const getQuestionByIdController = asyncHandler(async (req, res) => {
  const question = await service.getQuestionByIdService(req.params.questionId);

  return res.status(200).json({
    success: true,
    message: "Question fetched",
    data: question,
  });
});

export const getQuestionsBySubjectController = asyncHandler(async (req, res) => {
  const result = await service.getQuestionsBySubjectService(req.params.subjectId, req.query);

  return res.status(200).json({
    success: true,
    message: "Questions by subject fetched",
    data: result.items,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: Math.ceil(result.total / result.limit),
    },
  });
});

export const getQuestionsByTopicController = asyncHandler(async (req, res) => {
  const result = await service.getQuestionsByTopicService(req.params.topicId, req.query);

  return res.status(200).json({
    success: true,
    message: "Questions by topic fetched",
    data: result.items,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: Math.ceil(result.total / result.limit),
    },
  });
});

export const downloadQuestionTemplateController = asyncHandler(
  async (req, res) => {
    const templatePath = await generateQuestionTemplate();

    res.download(templatePath, "question_template.xlsx", (err) => {
      if (err) {
        console.error("Download error:", err);

        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "File not found or error downloading template",
          });
        }
      }
    });
  }
);