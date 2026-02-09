// modules/questions/questions.service.js
import {
  createQuestionRepo,
  updateQuestionRepo,
  deleteQuestionRepo,
  bulkInsertQuestionsRepo,
} from "./repositories/questions.repository.js";
import { validateQuestionByType } from "./utils/question.validator.js";

export const createQuestionService = async (payload) => {
  validateQuestionByType(payload);
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
export const bulkUploadQuestionsService = async (questions,user=null) => {
  //console.log(user," from bulk upload service");
  // validate...
  const mapped = questions.map(({ __row, ...q }) => ({
    ...q,
    createdBy:user?._id ?? null,
   
  }));

  return bulkInsertQuestionsRepo(mapped);
};

