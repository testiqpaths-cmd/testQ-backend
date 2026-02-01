// modules/questions/questions.service.js
import {
  createQuestionRepo,
  updateQuestionRepo,
  deleteQuestionRepo,
  bulkInsertQuestionsRepo,
} from "./repositories/questions.repository.js";
import { validateQuestionByType } from "./utils/question.validator.js";

export const createQuestionService = async (payload, user = null) => {
  validateQuestionByType(payload);

  return createQuestionRepo({
    ...payload,
    createdBy: user?._id ?? null,
    organizationId: user?.organizationId ?? null,
  });
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
  // validate...
  const mapped = questions.map(({ __row, ...q }) => ({
    ...q,
    createdBy: user?._id ?? null,
    organizationId: user?.organizationId ?? null,
  }));

  return bulkInsertQuestionsRepo(mapped);
};

