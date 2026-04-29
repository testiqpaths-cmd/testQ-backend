import Question from "../../../models/question.model.js";

const FRONTEND_TYPE_MAP = {
  MCQ: "multiple-choice",
  TRUE_FALSE: "true-false",
  SHORT: "short-answer",
  LONG: "long-answer",
};

const shuffle = (items = []) => {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
};

const buildFilters = (test) => {
  const filters = {};

  // Only apply subject/topic filters for SUBJECT_TOPIC source
  if (test.questionSource === "SUBJECT_TOPIC") {
    if (Array.isArray(test.subjectIds) && test.subjectIds.length) {
      filters.subjectId = { $in: test.subjectIds };
    }

    if (Array.isArray(test.topicIds) && test.topicIds.length) {
      filters.topicId = { $in: test.topicIds };
    }
  }

  // Apply type/difficulty filters for both sources
  if (Array.isArray(test.type) && test.type.length) {
    filters.type = { $in: test.type };
  }

  if (Array.isArray(test.difficulty) && test.difficulty.length) {
    filters.difficulty = { $in: test.difficulty };
  }

  // For EXCEL source, use excelBatchId
  if (test.questionSource === "EXCEL" && test.excelBatchId) {
    filters.excelBatchId = test.excelBatchId;
  }

  return filters;
};

const toSafeQuestion = (question, order) => ({
  id: question._id.toString(),
  questionId: question._id.toString(),
  text: question.questionText,
  type: FRONTEND_TYPE_MAP[question.type] || "multiple-choice",
  marks: question.marks ?? 0,
  options: Array.isArray(question.options)
    ? question.options.map((option, index) => ({
        id: index,
        text: option,
      }))
    : [],
  order,
});

export const selectAttemptQuestions = async (test) => {
  const filters = buildFilters(test);
  const desiredCount = Math.max(1, Number(test.totalQuestions) || 0);

  const questions = await Question.find(filters)
    .select("_id questionText type options correctAnswer marks")
    .lean();

  const selectedQuestions = shuffle(questions).slice(0, Math.min(desiredCount, questions.length));

  const questionSnapshots = selectedQuestions.map((question, index) => ({
    questionId: question._id,
    questionText: question.questionText,
    type: question.type,
    options: Array.isArray(question.options) ? question.options : [],
    correctAnswer: question.correctAnswer ?? null,
    marks: question.marks ?? 0,
    order: index,
    startedAt: null,
    lastViewedAt: null,
    timeSpentMs: 0,
  }));

  return {
    questionSnapshots,
    questions: questionSnapshots.map((question, index) =>
      toSafeQuestion(selectedQuestions[index], index),
    ),
  };
};

export const normalizeAttemptQuestion = (snapshot) => ({
  id: snapshot.questionId.toString(),
  questionId: snapshot.questionId.toString(),
  text: snapshot.questionText,
  type: FRONTEND_TYPE_MAP[snapshot.type] || "multiple-choice",
  marks: snapshot.marks ?? 0,
  options: Array.isArray(snapshot.options)
    ? snapshot.options.map((option, index) => ({
        id: index,
        text: option,
      }))
    : [],
  order: snapshot.order ?? 0,
});
