// modules/questions/repositories/questions.repository.js
import Question from "../../../models/question.model.js";

export const createQuestionRepo = (data) => Question.create(data);

export const updateQuestionRepo = (id, data) =>
  Question.findByIdAndUpdate(id, data, { new: true });

export const deleteQuestionRepo = (id) =>
  Question.findByIdAndDelete(id);

export const bulkInsertQuestionsRepo = (data) =>
  Question.insertMany(data);
