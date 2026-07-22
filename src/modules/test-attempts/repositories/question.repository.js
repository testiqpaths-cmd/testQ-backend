import Question from "../../../models/question.model.js";

export const findQuestionsByFiltersLeanRepo = (filters) =>
  Question.find(filters).select("_id questionText type options correctAnswer").lean();

export const findQuestionsByIdsRepo = (ids) =>
  Question.find({ _id: { $in: ids } }).select("_id type correctAnswer");
