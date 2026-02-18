import TestAttempt from "../../../models/testAttempt.model.js";
import Question from "../../../models/question.model.js"; // adjust path to your Question model

export const evaluateObjectiveForAttempt = async (attemptId) => {
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt) return null;

  // Evaluate only when submitted (or you can allow already evaluated)
  if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED") {
    return attempt;
  }

  if (!attempt.answers || attempt.answers.length === 0) {
    attempt.totalScore = 0;
    attempt.percentage = 0;
    attempt.status = "EVALUATED";
    await attempt.save();
    return attempt;
  }

  // Load all questions for answers
  const qIds = attempt.answers.map(a => a.questionId);
  const questions = await Question.find({ _id: { $in: qIds } })
    .select("_id type correctAnswer marks");

  const qMap = new Map(questions.map(q => [q._id.toString(), q]));

  let totalScore = 0;

  attempt.answers = attempt.answers.map((ans) => {
    const q = qMap.get(ans.questionId.toString());
    if (!q) return ans;

    // Only objective types
    if (q.type === "MCQ" || q.type === "TRUE_FALSE") {
      const studentAnswer = ans.selectedOption ?? ans.textAnswer; // depending on your schema usage
      const isCorrect = studentAnswer === q.correctAnswer;

      ans.isCorrect = isCorrect;
      ans.marksObtained = isCorrect ? (q.marks || 0) : 0;

      totalScore += ans.marksObtained;
      return ans;
    }

    // Subjective skipped
    ans.isCorrect = null;
    ans.marksObtained = ans.marksObtained ?? 0;
    return ans;
  });

  attempt.totalScore = totalScore;
  attempt.percentage =
    attempt.maxScore && attempt.maxScore > 0
      ? Math.round((totalScore / attempt.maxScore) * 100)
      : 0;

  attempt.status = "EVALUATED";
  await attempt.save();

  return attempt;
};
