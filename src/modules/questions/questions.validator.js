// src/modules/questions/questions.validator.js

export const validateQuestion = (question = {}) => {
  const errors = [];

  const topic = (question.topicId ?? "").trim();
const subject = (question.subjectId ?? "").trim();
  const questionText = (question.questionText ?? "").trim();
  const type = (question.type ?? "").trim();
  const marks = Number(question.marks);

  if (!topic) errors.push("Topic is required");
  if (!questionText) errors.push("Question text is required");
  if (!type) errors.push("Question type is required");
  if (!Number.isFinite(marks) || marks <= 0)
    errors.push("Marks must be greater than 0");

  // ✅ SAFE OPTIONS (NO CRASH EVER)
  const options = (question.options ?? []).map((o) =>
    String(o ?? "").trim()
  );

  // ✅ SAFE CORRECT ANSWER
  const correctAnswer = (question.correctAnswer ?? "").toString().trim();

  switch (type) {
    case "MCQ": {
      if (options.length !== 4) {
        errors.push("MCQ requires exactly 4 options");
        break;
      }

      if (!correctAnswer) {
        errors.push("MCQ correctAnswer is required");
        break;
      }

      if (!options.includes(correctAnswer)) {
        errors.push("MCQ correct answer must match one of the options");
      }

      break;
    }

    case "TRUE_FALSE": {
      const normalized = options.map((o) => o.toUpperCase());

      if (normalized.length !== 2) {
        errors.push("TRUE_FALSE must have exactly 2 options: TRUE/FALSE");
        break;
      }

      const set = new Set(normalized);

      if (!(set.has("TRUE") && set.has("FALSE"))) {
        errors.push("TRUE_FALSE options must be TRUE and FALSE");
      }

      const ca = correctAnswer.toUpperCase();

      if (!ca || !["TRUE", "FALSE"].includes(ca)) {
        errors.push("TRUE_FALSE correct answer must be TRUE or FALSE");
      }

      break;
    }

    case "SHORT": {
      if (!correctAnswer) {
        errors.push("SHORT answer must have a correctAnswer");
      }
      break;
    }

    case "LONG": {
      // optional
      break;
    }

    default:
      errors.push("Invalid question type");
  }

  return errors;
};