import XLSX from "xlsx";
import mongoose from "mongoose";
import path from "path";

import Question from "../../../models/question.model.js";
import {
  getSubjectByNameRepo,
  getTopicByNameAndSubjectRepo,
} from "../../subject-topic/repositories/subject-topic.repository.js";
import {
  createSubjectService,
  createTopicService,
} from "../../subject-topic/subject-topic.service.js";

export const normalizeText = (value) => String(value ?? "").trim();

const normalizeQuestionTextForDuplicate = (value) =>
  normalizeText(value).toLowerCase().replace(/\s+/g, " ");

export const buildQuestionDuplicateKey = ({ subjectId, topicId, type, questionText }) =>
  [
    String(subjectId ?? ""),
    String(topicId ?? ""),
    normalizeText(type).toUpperCase(),
    normalizeQuestionTextForDuplicate(questionText),
  ].join("|");

export const normalizeKey = (value) =>
  normalizeText(value).toLowerCase().replace(/[\s_-]+/g, "");

export const createRowReader = (row) => {
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

export const parseOptions = (value) => {
  if (Array.isArray(value)) {
    return value.map((option) => normalizeText(option)).filter(Boolean);
  }

  if (!value) return [];

  const str = normalizeText(value);
  const parts = str.includes("|") ? str.split("|") : str.split(",");

  return parts.map((option) => normalizeText(option)).filter(Boolean);
};

export const normalizeQuestionType = (value) => {
  const normalized = normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  const typeMap = {
    MCQ: "MCQ",
    TRUE_FALSE: "TRUE_FALSE",
    TRUEFALSE: "TRUE_FALSE",
    TRUE_OR_FALSE: "TRUE_FALSE",
  };

  return typeMap[normalized] || "";
};

export const normalizeDifficulty = (value) => {
  const normalized = normalizeText(value).toUpperCase();
  const difficultyMap = {
    EASY: "EASY",
    MEDIUM: "MEDIUM",
    HARD: "HARD",
  };

  return difficultyMap[normalized] || normalized;
};

export const toTimestampString = (date = new Date()) =>
  date.toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\..+$/, "");

export const sanitizeFileStem = (value) =>
  normalizeText(value)
    .replace(path.extname(String(value ?? "")), "")
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "questions";

export const buildExcelBatchMetadata = (originalName) => {
  const fileName = normalizeText(originalName) || "questions.xlsx";
  const fileStem = sanitizeFileStem(fileName);
  const timestamp = toTimestampString();

  return {
    excelBatchId: `${fileStem}_${timestamp}`,
    excelBatchName: `${fileName} - ${timestamp.replace("_", " ")}`,
    originalFileName: fileName,
  };
};

export const resolveSubjectId = async (value, createdBy = null) => {
  const subjectValue = normalizeText(value);

  if (!subjectValue) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(subjectValue)) {
    return subjectValue;
  }

  const subject = await getSubjectByNameRepo(subjectValue, createdBy);
  return subject?._id?.toString() ?? null;
};

export const resolveOrCreateSubjectId = async (value, createdBy) => {
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

export const resolveTopicId = async (value, subjectId) => {
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

export const resolveOrCreateTopicId = async (value, subjectId, createdBy) => {
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

export const normalizeCorrectAnswer = ({ type, correctAnswer, options }) => {
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

export const buildQuestionQuery = (filters = {}, options = {}) => {
  const { page = 1, limit = 10, sort = "-createdAt" } = options;

  return Question.find(filters)
    .populate("subjectId", "name description")
    .populate("topicId", "name description")
    .populate("createdBy", "name email")
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit);
};
