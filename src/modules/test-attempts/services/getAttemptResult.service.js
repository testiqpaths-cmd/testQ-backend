import TestAttempt from "../../../models/testAttempt.model.js";

export const getAttemptResult = async (attemptId) => {
  // Populate questionId but DO NOT expose correctAnswer
  const attempt = await TestAttempt.findById(attemptId).populate({
    path: "answers.questionId",
    select: "questionText type marks options topic subTopic", // ✅ no correctAnswer
  });

  return attempt;
};
