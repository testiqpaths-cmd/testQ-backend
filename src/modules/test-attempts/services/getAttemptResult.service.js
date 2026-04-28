import TestAttempt from "../../../models/testAttempt.model.js";

export const getAttemptResult = async (attemptId) => {
  // Populate questionId but DO NOT expose correctAnswer from DB
  // We'll use snapshots for correctAnswer (point-in-time capture)
  const attempt = await TestAttempt.findById(attemptId).populate({
    path: "answers.questionId",
    select: "questionText type marks options topic subTopic", // ✅ no correctAnswer
  });

  if (!attempt) return null;

  // ✅ Enrich answers with correctAnswer from questionSnapshots
  const snapshotMap = new Map(
    (attempt.questionSnapshots || []).map((s) => [
      s.questionId.toString(),
      {
        correctAnswer: s.correctAnswer,
        questionText: s.questionText,
        options: s.options,
        marks: s.marks,
      },
    ])
  );

  // Merge snapshot data into answers for result display
  const enrichedAnswers = (attempt.answers || []).map((answer) => ({
    ...answer.toObject ? answer.toObject() : answer,
    correctAnswer: snapshotMap.get(answer.questionId._id?.toString())?.correctAnswer,
  }));

  // Return with enriched data
  return {
    ...attempt.toObject ? attempt.toObject() : attempt,
    answers: enrichedAnswers,
  };
};
