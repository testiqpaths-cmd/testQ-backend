// modules/questions/questions.controller.js
import {asyncHandler} from "../../common/utils/asyncHandler.js";
import * as service from "./questions.service.js";
import XLSX from "xlsx";
import Question from "../../models/question.model.js";
import mongoose from "mongoose";
import logger from "../../config/logger.js";
import { validateQuestion } from "./questions.validator.js";
import {
  getSubjectByNameRepo,
  getTopicByNameAndSubjectRepo,
} from "../subject-topic/repositories/subject-topic.repository.js";
import {
  createSubjectService,
  createTopicService,
} from "../subject-topic/subject-topic.service.js";
import { v4 as uuidv4 } from "uuid";


export const createQuestion = asyncHandler(async (req, res) => {
  const payload = {
    subjectId: req.body.subjectId || req.body.topic,
    topicId: req.body.topicId || req.body.subTopic,
    questionText: req.body.questionText,
    type: req.body.type,
    options: Array.isArray(req.body.options) ? req.body.options : [],
    correctAnswer: req.body.correctAnswer,
    marks: req.body.marks,
    difficulty: req.body.difficulty,
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

const normalizeText = (value) => String(value ?? "").trim();

const normalizeQuestionTextForDuplicate = (value) =>
  normalizeText(value).toLowerCase().replace(/\s+/g, " ");

const buildQuestionDuplicateKey = ({ subjectId, topicId, type, questionText }) =>
  [
    String(subjectId ?? ""),
    String(topicId ?? ""),
    normalizeText(type).toUpperCase(),
    normalizeQuestionTextForDuplicate(questionText),
  ].join("|");

const normalizeKey = (value) =>
  normalizeText(value).toLowerCase().replace(/[\s_-]+/g, "");

const createRowReader = (row) => {
  const lookup = new Map(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value])
  );

  return (aliases = []) => {
    for (const alias of aliases) {
      const value = lookup.get(normalizeKey(alias));
      if (normalizeText(value)) {
        return value;
      }
    }

    return "";
  };
};

const parseOptions = (value) => {
  if (Array.isArray(value)) {
    return value.map((option) => normalizeText(option)).filter(Boolean);
  }

  if (!value) return [];

  const str = normalizeText(value);
  const parts = str.includes("|") ? str.split("|") : str.split(",");

  return parts.map((option) => normalizeText(option)).filter(Boolean);
};

const normalizeQuestionType = (value) => {
  const normalized = normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  const typeMap = {
    MCQ: "MCQ",
    MULTIPLE_CHOICE: "MCQ",
    MULTIPLECHOICE: "MCQ",
    TRUE_FALSE: "TRUE_FALSE",
    TRUEFALSE: "TRUE_FALSE",
    TRUE_OR_FALSE: "TRUE_FALSE",
    SHORT: "SHORT",
    SHORT_ANSWER: "SHORT",
    SHORTANSWER: "SHORT",
    LONG: "LONG",
    LONG_ANSWER: "LONG",
    LONGANSWER: "LONG",
  };

  return typeMap[normalized] || normalized;
};

const normalizeDifficulty = (value) => {
  const normalized = normalizeText(value).toUpperCase();
  const difficultyMap = {
    EASY: "EASY",
    MEDIUM: "MEDIUM",
    HARD: "HARD",
  };

  return difficultyMap[normalized] || normalized;
};

const resolveSubjectId = async (value) => {
  const subjectValue = normalizeText(value);

  if (!subjectValue) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(subjectValue)) {
    return subjectValue;
  }

  const subject = await getSubjectByNameRepo(subjectValue);
  return subject?._id?.toString() ?? null;
};

const resolveOrCreateSubjectId = async (value, createdBy) => {
  const subjectValue = normalizeText(value);

  if (!subjectValue) {
    return null;
  }

  const existingSubjectId = await resolveSubjectId(subjectValue);
  if (existingSubjectId) {
    return existingSubjectId;
  }

  const subject = await createSubjectService({
    name: subjectValue,
    description: "",
    createdBy,
  });

  return subject?._id?.toString() ?? null;
};

const resolveTopicId = async (value, subjectId) => {
  const topicValue = normalizeText(value);

  if (!topicValue) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(topicValue)) {
    return topicValue;
  }

  if (!subjectId) {
    return null;
  }

  const topic = await getTopicByNameAndSubjectRepo(topicValue, subjectId);
  return topic?._id?.toString() ?? null;
};

const resolveOrCreateTopicId = async (value, subjectId, createdBy) => {
  const topicValue = normalizeText(value);

  if (!topicValue || !subjectId) {
    return null;
  }

  const existingTopicId = await resolveTopicId(topicValue, subjectId);
  if (existingTopicId) {
    return existingTopicId;
  }

  const topic = await createTopicService({
    name: topicValue,
    subjectId,
    createdBy,
  });

  return topic?._id?.toString() ?? null;
};

const normalizeCorrectAnswer = ({ type, correctAnswer, options }) => {
  const answer = normalizeText(correctAnswer);

  if (!answer) {
    return "";
  }

  if (type === "MCQ") {
    const optionIndexMap = {
      A: 0,
      B: 1,
      C: 2,
      D: 3,
      1: 0,
      2: 1,
      3: 2,
      4: 3,
    };

    const selectedIndex = optionIndexMap[answer.toUpperCase()];
    if (selectedIndex !== undefined && options[selectedIndex]) {
      return options[selectedIndex];
    }

    const matchedOption = options.find(
      (option) => normalizeText(option).toLowerCase() === answer.toLowerCase()
    );

    return matchedOption || answer;
  }

  if (type === "TRUE_FALSE") {
    if (/^true$/i.test(answer)) return "TRUE";
    if (/^false$/i.test(answer)) return "FALSE";
  }

  return answer;
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

  const uploadedBy = req.user?._id;
  const formSubjectValue = req.body.subjectId ?? req.body.subject;
  const formTopicValue = req.body.topicId ?? req.body.topic;

  const defaultSubjectId = await resolveOrCreateSubjectId(formSubjectValue, uploadedBy);
  const defaultTopicId = defaultSubjectId
    ? await resolveOrCreateTopicId(formTopicValue, defaultSubjectId, uploadedBy)
    : null;
  const hasFormDefaults = Boolean(defaultSubjectId && defaultTopicId);

  const questions = [];
  const rowErrors = [];
  const excelBatchId = uuidv4();

  for (const [index, row] of rows.entries()) {
    const read = createRowReader(row);

    const rowSubjectRaw = read([
      "subjectId",
      "subject",
      "Subject",
      "Subject ID",
      "subjectName",
      "Subject Name",
    ]);

    const rowTopicRaw = read([
      "topicId",
      "topic",
      "Topic",
      "Topic ID",
      "topicName",
      "Topic Name",
    ]);

    const rowSubjectId = await resolveOrCreateSubjectId(rowSubjectRaw, uploadedBy);
    const subjectId = hasFormDefaults ? defaultSubjectId : rowSubjectId || defaultSubjectId;

    const rowTopicId = await resolveOrCreateTopicId(
      rowTopicRaw,
      subjectId,
      uploadedBy
    );
    const topicId = hasFormDefaults ? defaultTopicId : rowTopicId || defaultTopicId;

    const options = parseOptions(
      read(["options", "Options", "answerOptions", "Answer Options"])
    );

    if (!options.length) {
      const indexedOptions = [
        read(["option1", "Option 1", "A"]),
        read(["option2", "Option 2", "B"]),
        read(["option3", "Option 3", "C"]),
        read(["option4", "Option 4", "D"]),
      ]
        .map((option) => normalizeText(option))
        .filter(Boolean);

      options.push(...indexedOptions);
    }

    const type = normalizeQuestionType(read(["type", "Type", "questionType", "Question Type"]));
    const questionText = normalizeText(
      read(["questionText", "Question Text", "question", "Question"])
    );
    const marks = Number(
      read(["marks", "Marks", "points", "Points"]) || 0
    );
    const difficulty = normalizeDifficulty(
      read(["difficulty", "Difficulty"])
    ) || "EASY";
    const correctAnswer = normalizeCorrectAnswer({
      type,
      correctAnswer: read([
        "correctAnswer",
        "Correct Answer",
        "answer",
        "Answer",
      ]),
      options,
    });

    const rowNumber = index + 2;
    const missingFields = [];

    if (!subjectId) {
      missingFields.push("subject (provide in row or form-level subject)");
    }
    if (!topicId) {
      missingFields.push("topic (provide in row or form-level topic)");
    }
    if (!questionText) missingFields.push("question text");
    if (!type) missingFields.push("question type");
    if (!Number.isFinite(marks) || marks <= 0) missingFields.push("marks");

    if (missingFields.length) {
      rowErrors.push(`Row ${rowNumber}: missing or invalid ${missingFields.join(", ")}`);
      continue;
    }

    const validationErrors = validateQuestion({
      subjectId,
      topicId,
      questionText,
      type,
      options,
      correctAnswer,
      marks,
      difficulty,
    });

    if (validationErrors.length) {
      rowErrors.push(`Row ${rowNumber}: ${validationErrors.join(", ")}`);
      continue;
    }

    questions.push({
      __row: rowNumber,
      subjectId,
      topicId,
      questionText,
      type,
      options,
      correctAnswer,
      marks,
      difficulty,
      excelBatchId,
    });
  }

  // console.log("📄 Sheet:", sheetName);
  // console.log("🧾 First 3 mapped questions:", questions.slice(0, 3));

  if (!questions.length) {
    return res.status(400).json({
      success: false,
      message: "No valid questions were found in the Excel file",
      errors: rowErrors,
    });
  }

  // Remove duplicates within uploaded file first.
  const uploadSeenKeys = new Set();
  const uniqueQuestions = [];

  for (const question of questions) {
    const duplicateKey = buildQuestionDuplicateKey(question);
    if (uploadSeenKeys.has(duplicateKey)) {
      rowErrors.push(
        `Row ${question.__row}: duplicate question in uploaded file for same subject/topic/type`
      );
      continue;
    }

    uploadSeenKeys.add(duplicateKey);
    uniqueQuestions.push(question);
  }

  // Skip duplicates that already exist in DB for same subject + topic + type + question text.
  const pairKeys = [...new Set(uniqueQuestions.map((q) => `${q.subjectId}|${q.topicId}`))];
  const pairFilters = pairKeys.map((pair) => {
    const [subjectId, topicId] = pair.split("|");
    return { subjectId, topicId };
  });

  const existingQuestions = pairFilters.length
    ? await Question.find({ $or: pairFilters })
        .select("subjectId topicId type questionText")
        .lean()
    : [];

  const existingKeys = new Set(
    existingQuestions.map((q) =>
      buildQuestionDuplicateKey({
        subjectId: q.subjectId,
        topicId: q.topicId,
        type: q.type,
        questionText: q.questionText,
      })
    )
  );

  const questionsToInsert = [];

  for (const question of uniqueQuestions) {
    const duplicateKey = buildQuestionDuplicateKey(question);
    if (existingKeys.has(duplicateKey)) {
      rowErrors.push(
        `Row ${question.__row}: question already exists for this subject/topic/type in database`
      );
      continue;
    }

    questionsToInsert.push(question);
  }

  if (!questionsToInsert.length) {
    return res.status(200).json({
      success: true,
      message: "No new questions uploaded. All valid rows were duplicates.",
      uploaded: 0,
      skipped: rowErrors.length,
      warnings: rowErrors,
    });
  }

  // ✅ no auth → no user passed
  // console.log("User in request:", req.user);
  await service.bulkUploadQuestionsService(questionsToInsert, req.user);
  // console.log("Bulk upload complete");

  res.json({
    success: true,
    message: `${questionsToInsert.length} questions uploaded`,
    excelBatchId,
    uploaded: questionsToInsert.length,
    skipped: rowErrors.length,
    warnings: rowErrors.length ? rowErrors : undefined,
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

export const getMyExcelBatchesController = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  const batches = await Question.aggregate([
    {
      $match: {
        createdBy: new mongoose.Types.ObjectId(userId),
        excelBatchId: { $ne: null },
      },
    },
    {
      $group: {
        _id: "$excelBatchId",
        questionCount: { $sum: 1 },
        uploadedAt: { $max: "$createdAt" },
      },
    },
    { $sort: { uploadedAt: -1 } },
  ]);

  res.json({
    success: true,
    data: batches.map((item) => ({
      batchId: item._id,
      questionCount: item.questionCount,
      uploadedAt: item.uploadedAt,
    })),
  });
});

export const getQuestionsByExcelBatchController = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { batchId } = req.params;
  const { quantity, difficulty } = req.query;

  const filters = {
    createdBy: userId,
    excelBatchId: batchId,
  };

  if (difficulty) {
    filters.difficulty = String(difficulty).toUpperCase();
  }

  let query = Question.find(filters)
    .populate("subjectId", "name")
    .populate("topicId", "name")
    .sort({ createdAt: -1 });

  const limit = Number(quantity);
  if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const items = await query;
  return res.json({ success: true, data: items });
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