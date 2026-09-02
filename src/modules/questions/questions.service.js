import XLSX from "xlsx";
import mongoose from "mongoose";
import { ApiError } from "../../common/exceptions/ApiError.js";
import Question from "../../models/question.model.js";
import UserModel from "../../models/user.model.js";
import { uploadBufferToCloudinary } from "../../common/utils/cloudinary.js";
import { validateQuestion } from "./questions.validator.js";
import {
  createQuestionRepo,
  updateQuestionRepo,
  deleteQuestionRepo,
  bulkInsertQuestionsRepo,
  getQuestionByIdRepo,
} from "./repositories/questions.repository.js";
import {
  buildQuestionDuplicateKey,
  buildExcelBatchMetadata,
  buildQuestionQuery,
  createRowReader,
  normalizeCorrectAnswer,
  normalizeDifficulty,
  normalizeQuestionType,
  parseOptions,
  resolveOrCreateCompanyId,
  resolveOrCreateSubjectId,
  resolveOrCreateTopicId,
} from "./utils/questions.utils.js";

const normalizeText = (value) => String(value ?? "").trim();

const toQueryList = (...values) =>
  values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return String(value ?? "")
        .split(",")
        .map((item) => item.trim());
    })
    .filter(Boolean);

export const createQuestionService = async (payload) => {
  const errors = validateQuestion(payload);

  if (errors.length) {
    throw new ApiError(400, errors.join(", "));
  }

  return createQuestionRepo(payload);
};

// An ORGANIZATION-role caller may only edit/delete questions authored by
// someone in their own organization — otherwise any org could edit or
// delete another org's (or admin's) question bank entries just by knowing
// the id. IQPATH_ADMIN retains full access.
const assertQuestionAccess = async (id, requester) => {
  const question = await getQuestionByIdRepo(id);
  if (!question) {
    throw new ApiError(404, "Question not found");
  }
  if (!requester || requester.role === "IQPATH_ADMIN") return question;

  if (requester.role === "ORGANIZATION") {
    const authorIds = await resolveOwnOrgQuestionAuthorIds(requester);
    const authorId = question.createdBy?._id || question.createdBy;
    if (authorId && authorIds.some((authorIdInOrg) => String(authorIdInOrg) === String(authorId))) {
      return question;
    }
  }

  throw new ApiError(403, "Forbidden");
};

export const updateQuestionService = async (id, payload, requester = null) => {
  const errors = validateQuestion(payload);

  if (errors.length) {
    throw new ApiError(400, errors.join(", "));
  }

  await assertQuestionAccess(id, requester);
  return updateQuestionRepo(id, payload);
};

export const deleteQuestionService = async (id, requester = null) => {
  await assertQuestionAccess(id, requester);
  return deleteQuestionRepo(id);
};

export const uploadQuestionImageService = async (file) => {
  try {
    const result = await uploadBufferToCloudinary(file.buffer, file.mimetype, "question-images");
    return result.secure_url;
  } catch (error) {
    throw new ApiError(502, `Image upload failed: ${error.message}`);
  }
};

export const bulkUploadQuestionsService = async (questions, user = null) => {
  if (!Array.isArray(questions)) {
    throw new ApiError(400, "Questions must be an array");
  }

  const mapped = questions.map(({ __row, ...q }) => ({
    ...q,
    createdBy: user?._id ?? null,
  }));

  return bulkInsertQuestionsRepo(mapped);
};

export const uploadQuestionsExcelService = async ({
  fileBuffer,
  originalname,
  subjectId: formSubjectValue,
  subject: fallbackSubjectValue,
  topicId: formTopicValue,
  topic: fallbackTopicValue,
  companyIds: formCompanyIds = [], // ✅ Added companyIds support
  excelBatchId: clientBatchId,
  excelBatchName: clientBatchName,
  user = null,
}) => {
  if (!fileBuffer) {
    throw new ApiError(400, "Excel file is required (field name: file)");
  }

  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const uploadedBy = user?._id;
  const batchMeta = buildExcelBatchMetadata(originalname, clientBatchId, clientBatchName);
  const selectedSubjectValue = formSubjectValue ?? fallbackSubjectValue;
  const selectedTopicValue = formTopicValue ?? fallbackTopicValue;

  const defaultSubjectId = await resolveOrCreateSubjectId(selectedSubjectValue, uploadedBy);
  const defaultTopicId = defaultSubjectId
    ? await resolveOrCreateTopicId(selectedTopicValue, defaultSubjectId, uploadedBy)
    : null;
  const hasFormDefaults = Boolean(defaultSubjectId && defaultTopicId);

  // Normalize companyIds list for all rows in this batch
  const batchCompanyIds = Array.isArray(formCompanyIds)
    ? formCompanyIds
    : formCompanyIds
    ? [formCompanyIds]
    : [];

  const questions = [];
  const rowErrors = [];

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

    const companyValue = read([
  "company",
  "companyName",
  "targetCompany",
]);
    // ✅ Resolve the row's own Company column — same as
    // resolveOrCreateSubjectId/resolveOrCreateTopicId below, an unrecognized
    // name creates a new Company rather than being silently dropped — and
    // merge it into this row's companyIds alongside whatever batch-level
    // companyIds were selected for the whole upload.
    const rowCompanyId = await resolveOrCreateCompanyId(companyValue);
    const rowCompanyIds =
      rowCompanyId && !batchCompanyIds.map(String).includes(String(rowCompanyId))
        ? [...batchCompanyIds, rowCompanyId]
        : batchCompanyIds;

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

    const rowTopicId = await resolveOrCreateTopicId(rowTopicRaw, subjectId, uploadedBy);
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
    const difficulty = normalizeDifficulty(read(["difficulty", "Difficulty"])) || "EASY";
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
    const imageUrl = normalizeText(
      read(["imageUrl", "Image URL", "image", "Image", "Image Link"])
    ) || null;

    const rowNumber = index + 2;
    const missingFields = [];

    if (!questionText) missingFields.push("question text");
    if (!type) missingFields.push("question type (MCQ or TRUE_FALSE)");

    if (missingFields.length) {
      rowErrors.push(`Row ${rowNumber}: missing or invalid ${missingFields.join(", ")}`);
      continue;
    }

    const validationErrors = validateQuestion({
      subjectId,
      topicId,
      companyIds: rowCompanyIds,
      questionText,
      type,
      options,
      correctAnswer,
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
      companyIds: rowCompanyIds, // ✅ Attached company tags (batch-level + row's own Company column)
      questionText,
      type,
      options,
      correctAnswer,
      difficulty,
      imageUrl,
      excelBatchId: batchMeta.excelBatchId,
      excelBatchName: batchMeta.excelBatchName,
    });
  }

  if (!questions.length) {
    throw new ApiError(400, "No valid questions were found in the Excel file", rowErrors);
  }

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

  // Deduplicate on a Map (not a stringified-then-split key) so a missing
  // subjectId/topicId — legitimate now that a question can be company-only —
  // stays the real `null` here instead of round-tripping through the string
  // "null", which Mongoose then rejects as an invalid ObjectId when this
  // filter hits Question.find() below.
  const pairFilterByKey = new Map();
  for (const q of uniqueQuestions) {
    const key = `${q.subjectId}|${q.topicId}`;
    if (!pairFilterByKey.has(key)) {
      pairFilterByKey.set(key, { subjectId: q.subjectId ?? null, topicId: q.topicId ?? null });
    }
  }
  const pairFilters = [...pairFilterByKey.values()];

  const existingQuestions = pairFilters.length
    ? await Question.find({ $or: pairFilters })
        .select("subjectId topicId type questionText")
        .lean()
    : [];

  const existingKeys = new Set(
    existingQuestions.map((question) =>
      buildQuestionDuplicateKey({
        subjectId: question.subjectId,
        topicId: question.topicId,
        type: question.type,
        questionText: question.questionText,
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
    return {
      statusCode: 200,
      success: true,
      message: "No new questions uploaded. All valid rows were duplicates.",
      uploaded: 0,
      skipped: rowErrors.length,
      warnings: rowErrors,
      excelBatchId: batchMeta.excelBatchId,
      excelBatchName: batchMeta.excelBatchName,
    };
  }

  await bulkUploadQuestionsService(questionsToInsert, user);

  return {
    statusCode: 200,
    success: true,
    message: `${questionsToInsert.length} questions uploaded`,
    excelBatchId: batchMeta.excelBatchId,
    excelBatchName: batchMeta.excelBatchName,
    uploaded: questionsToInsert.length,
    skipped: rowErrors.length,
    warnings: rowErrors.length ? rowErrors : undefined,
  };
};

export const getMyExcelBatchesService = async (userId) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid userId");
  }

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
        batchName: { $first: "$excelBatchName" },
      },
    },
    { $sort: { uploadedAt: -1 } },
  ]);

  return batches.map((item) => ({
    batchId: item._id,
    batchName: item.batchName || item._id,
    questionCount: item.questionCount,
    uploadedAt: item.uploadedAt,
  }));
};

export const getQuestionsByExcelBatchService = async ({ userId, batchId, quantity, difficulty }) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid userId");
  }

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

  return query;
};

const resolveOwnOrgQuestionAuthorIds = async (requester) => {
  let orgId = requester.organizationId || null;
  if (!orgId) {
    const dbUser = await UserModel.findById(requester._id).select("organizationId").lean();
    orgId = dbUser?.organizationId ?? null;
  }
  if (!orgId) return [];
  return UserModel.find({ organizationId: orgId }).distinct("_id");
};

export const getAllQuestionsService = async (query = {}, requester = null) => {
  const {
    subjectId,
    topicId,
    companyId, // ✅ Support companyId
    type,
    difficulty,
    page = 1,
    limit,
    quantity,
    sort = "-createdAt",
  } = query;

  const filters = {};
  const subjectIds = toQueryList(subjectId, query.subjectIds, query["subjectId[]"], query["subjectIds[]"]);
  const topicIds = toQueryList(topicId, query.topicIds, query["topicId[]"], query["topicIds[]"]);
  // ✅ Parse company IDs from query
  const companyIds = toQueryList(companyId, query.companyIds, query["companyId[]"], query["companyIds[]"]);

  if (subjectIds.length === 1) filters.subjectId = subjectIds[0];
  if (subjectIds.length > 1) filters.subjectId = { $in: subjectIds };
  if (topicIds.length === 1) filters.topicId = topicIds[0];
  if (topicIds.length > 1) filters.topicId = { $in: topicIds };
  // ✅ Apply company filtering
  if (companyIds.length > 0) filters.companyIds = { $in: companyIds };

  if (type) filters.type = type;
  if (difficulty) filters.difficulty = String(difficulty).toUpperCase();

  // Only the "Questions" management page sends mine=true
  if (String(query.mine) === "true" && requester?.role === "ORGANIZATION") {
    const authorIds = await resolveOwnOrgQuestionAuthorIds(requester);
    filters.createdBy = { $in: authorIds };
  }

  const pageNum = Math.max(1, Number(page));
  const resolvedLimit = limit ?? quantity ?? 10;
  const limitNum = Math.max(1, Number(resolvedLimit));

  const [items, total] = await Promise.all([
    buildQuestionQuery(filters, {
      page: pageNum,
      limit: limitNum,
      sort,
    }),
    Question.countDocuments(filters),
  ]);

  return {
    items,
    total,
    filters,
    page: pageNum,
    limit: limitNum,
  };
};

export const getQuestionsByUserIdService = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid userId");
  }

  return Question.find({ createdBy: userId })
    .populate("subjectId", "name description")
    .populate("topicId", "name description")
    .populate("companyIds", "name logo")
    .sort("-createdAt");
};

export const getQuestionByIdService = async (questionId) => {
  if (!mongoose.Types.ObjectId.isValid(questionId)) {
    throw new ApiError(400, "Invalid questionId");
  }

  const question = await getQuestionByIdRepo(questionId);

  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  return question;
};

export const getQuestionsBySubjectService = async (subjectId, query = {}) => {
  if (!mongoose.Types.ObjectId.isValid(subjectId)) {
    throw new ApiError(400, "Invalid subjectId");
  }

  const { page = 1, limit = 10, sort = "-createdAt", type, difficulty } = query;
  const filters = { subjectId };

  if (type) filters.type = type;
  if (difficulty) filters.difficulty = String(difficulty).toUpperCase();

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  const [items, total] = await Promise.all([
    buildQuestionQuery(filters, {
      page: pageNum,
      limit: limitNum,
      sort,
    }),
    Question.countDocuments(filters),
  ]);

  return {
    items,
    total,
    page: pageNum,
    limit: limitNum,
  };
};

export const getQuestionsByTopicService = async (topicId, query = {}) => {
  if (!mongoose.Types.ObjectId.isValid(topicId)) {
    throw new ApiError(400, "Invalid topicId");
  }

  const { page = 1, limit = 10, sort = "-createdAt", type, difficulty } = query;
  const filters = { topicId };

  if (type) filters.type = type;
  if (difficulty) filters.difficulty = String(difficulty).toUpperCase();

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  const [items, total] = await Promise.all([
    buildQuestionQuery(filters, {
      page: pageNum,
      limit: limitNum,
      sort,
    }),
    Question.countDocuments(filters),
  ]);

  return {
    items,
    total,
    page: pageNum,
    limit: limitNum,
  };
};

// ✅ New: Service to fetch questions by company ID
export const getQuestionsByCompanyService = async (companyId, query = {}) => {
  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw new ApiError(400, "Invalid companyId");
  }

  const { page = 1, limit = 10, sort = "-createdAt", type, difficulty } = query;
  const filters = { companyIds: companyId };

  if (type) filters.type = type;
  if (difficulty) filters.difficulty = String(difficulty).toUpperCase();

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  const [items, total] = await Promise.all([
    buildQuestionQuery(filters, {
      page: pageNum,
      limit: limitNum,
      sort,
    }),
    Question.countDocuments(filters),
  ]);

  return {
    items,
    total,
    page: pageNum,
    limit: limitNum,
  };
};