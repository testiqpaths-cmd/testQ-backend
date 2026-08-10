// modules/questions/repositories/questions.repository.js
import Question from "../../../models/question.model.js";

export const createQuestionRepo = (data) => Question.create(data);

export const updateQuestionRepo = (id, data) =>
  Question.findByIdAndUpdate(id, data, { new: true });

export const deleteQuestionRepo = (id) =>
  Question.findByIdAndDelete(id);

export const bulkInsertQuestionsRepo = (data) =>
  Question.insertMany(data);

// Get questions with filters and pagination
export const getQuestionsWithFiltersRepo = (filters, options = {}) => {
  const { page = 1, limit = 10, sort = "-createdAt" } = options;

  // Read-only (list/pagination view, never saved) — .lean() skips
  // Mongoose document hydration for every row in the page.
  return Question.find(filters)
    .populate("subjectId", "name description")
    .populate("topicId", "name description")
    .populate("createdBy", "name email")
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
};

// Count questions with filters
export const countQuestionsRepo = (filters) => Question.countDocuments(filters);

// Get questions by subject
export const getQuestionsBySubjectRepo = (subjectId, options = {}) => {
  return getQuestionsWithFiltersRepo({ subjectId }, options);
};

// Get questions by topic
export const getQuestionsByTopicRepo = (topicId, options = {}) => {
  return getQuestionsWithFiltersRepo({ topicId }, options);
};

// Get question by ID with populated data — read-only (access checks +
// serialized API responses), never saved.
export const getQuestionByIdRepo = (id) =>
  Question.findById(id)
    .populate("subjectId", "name description")
    .populate("topicId", "name description")
    .populate("createdBy", "name email")
    .lean();

// Get questions by user — read-only list view.
export const getQuestionsByUserRepo = (userId, options = {}) => {
  const { sort = "-createdAt" } = options;
  return Question.find({ createdBy: userId })
    .populate("subjectId", "name description")
    .populate("topicId", "name description")
    .sort(sort)
    .lean();
};
