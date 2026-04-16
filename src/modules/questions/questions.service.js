// modules/questions/questions.service.js
import {
  createQuestionRepo,
  updateQuestionRepo,
  deleteQuestionRepo,
  bulkInsertQuestionsRepo,
} from "./repositories/questions.repository.js";
//import {  } from "./questions.validator";
import { validateQuestion } from "./questions.validator.js";

export const createQuestionService = async (payload) => {
  const errors = validateQuestion(payload);

  if (errors.length) {
    throw new ApiError(400, errors.join(", "));
  }

  return createQuestionRepo(payload);
};
export const updateQuestionService = async (id, payload) => {
  validateQuestionByType(payload);
  return updateQuestionRepo(id, payload);
};

export const deleteQuestionService = async (id) => {
  return deleteQuestionRepo(id);
};

// modules/questions/questions.service.js
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
