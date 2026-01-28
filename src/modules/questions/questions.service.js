// modules/questions/questions.service.js
import {
  createQuestionRepo,
  updateQuestionRepo,
  deleteQuestionRepo,
  bulkInsertQuestionsRepo,
} from "./repositories/questions.repository.js";
import { validateQuestionByType } from "./utils/question.validator.js";

export const createQuestionService = async (payload, user) => {
  validateQuestionByType(payload);

  return createQuestionRepo({
    ...payload,
    createdBy: user._id,
    organizationId: user.organizationId,
  });
};

export const updateQuestionService = async (id, payload) => {
  validateQuestionByType(payload);
  return updateQuestionRepo(id, payload);
};

export const deleteQuestionService = async (id) => {
  return deleteQuestionRepo(id);
};

export const bulkUploadQuestionsService = async (questions, user) => {
  questions.forEach(validateQuestionByType);

  const mapped = questions.map((q) => ({
    ...q,
    createdBy: user._id,
    organizationId: user.organizationId,
  }));

  return bulkInsertQuestionsRepo(mapped);
};
