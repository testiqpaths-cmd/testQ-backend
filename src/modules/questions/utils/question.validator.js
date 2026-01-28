// modules/questions/utils/question.validator.js
import { QUESTION_TYPES } from "../constants/question.types.js";
import { ApiError } from "../../../common/exceptions/ApiError.js";

export const validateQuestionByType = (data) => {
  const { type, options = [], correctAnswer } = data;

  if (data.marks <= 0) {
    throw new ApiError(400, "Marks must be greater than 0");
  }

  switch (type) {
    case QUESTION_TYPES.MCQ:
      if (options.length !== 4) {
        throw new ApiError(400, "MCQ must have exactly 4 options");
      }
      if (!options.includes(correctAnswer)) {
        throw new ApiError(400, "Correct answer must match one option");
      }
      break;

    case QUESTION_TYPES.TRUE_FALSE:
      if (
        options.length !== 2 ||
        !options.includes("TRUE") ||
        !options.includes("FALSE")
      ) {
        throw new ApiError(400, "TRUE_FALSE options must be TRUE and FALSE");
      }
      if (!["TRUE", "FALSE"].includes(correctAnswer)) {
        throw new ApiError(400, "Correct answer must be TRUE or FALSE");
      }
      break;

    case QUESTION_TYPES.SHORT:
      if (!correctAnswer) {
        throw new ApiError(400, "SHORT question requires correct answer");
      }
      break;

    case QUESTION_TYPES.LONG:
      // optional reference answer
      break;
  }
};
