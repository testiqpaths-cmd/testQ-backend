// src/modules/questions/questions.validator.js

export const validateQuestion = (question = {}) => {
  const errors = [];

  // Safe string normalization (won't crash on ObjectIds or null/undefined)
  const topic = String(question.topicId ?? "").trim();
  const subject = String(question.subjectId ?? "").trim();
  const questionText = String(question.questionText ?? "").trim();
  const type = String(question.type ?? "").trim();

  // Normalize companyIds
  const companyIds = Array.isArray(question.companyIds)
    ? question.companyIds.filter(Boolean)
    : question.companyId
    ? [question.companyId]
    : [];

  // ✅ CONDITION: Either Subject/Topic OR Company (or both) must be provided
  const hasSubjectOrTopic = Boolean(subject || topic);
  const hasCompany = companyIds.length > 0;

  if (!hasSubjectOrTopic && !hasCompany) {
    errors.push("Question must be associated with at least one Subject or Target Company");
  }

  if (!questionText) errors.push("Question text is required");
  if (!type) errors.push("Question type is required");

  // ✅ SAFE OPTIONS (NO CRASH EVER)
  const options = (question.options ?? []).map((o) =>
    String(o ?? "").trim()
  );

  // ✅ SAFE CORRECT ANSWER
  const correctAnswer = String(question.correctAnswer ?? "").trim();

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

    default:
      errors.push("Only MCQ and TRUE_FALSE question types are supported");
  }

  return errors;
};