// src/modules/questions/questions.validator.js
export const validateQuestion = (question) => {
  const errors = [];

  if (!question.topic) errors.push("Topic is required");
  if (!question.questionText) errors.push("Question text is required");
  if (!question.type) errors.push("Question type is required");
  if (!question.marks || question.marks <= 0) errors.push("Marks must be > 0");

  switch (question.type) {
    case "MCQ":
      if (!question.options || question.options.length !== 4)
        errors.push("MCQ requires exactly 4 options");
      if (!question.correctAnswer || !question.options.includes(question.correctAnswer))
        errors.push("MCQ correct answer must match one of the options");
      break;
    case "TRUE_FALSE":
      if (!question.options || question.options.length !== 2)
        errors.push("TRUE_FALSE must have exactly 2 options: TRUE/FALSE");
      if (!question.correctAnswer || !["TRUE", "FALSE"].includes(question.correctAnswer))
        errors.push("TRUE_FALSE correct answer must be TRUE or FALSE");
      break;
    case "SHORT":
      if (!question.correctAnswer) errors.push("SHORT answer must have a correctAnswer");
      break;
    case "LONG":
      // Reference answer optional
      break;
    default:
      errors.push("Invalid question type");
  }

  return errors;
};
