import TestAttempt from "../../../models/testAttempt.model.js";
import Question from "../../../models/question.model.js";

const PASS_PERCENTAGE = 40;

export const evaluateObjectiveForAttempt = async (attemptId) => {
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt) return null;

  // only run after submission (or re-run if already evaluated)
  if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED") {
    return attempt;
  }

  // If no answers, don't mark evaluated (could be subjective test with no answers too)
  if (!attempt.answers || attempt.answers.length === 0) {
    attempt.totalScore = 0;
    attempt.percentage = 0;
    // keep it SUBMITTED so manual evaluation can happen if needed
    attempt.status = "SUBMITTED";
    await attempt.save();
    return attempt;
  }

  const qIds = attempt.answers.map((a) => a.questionId);
  const questions = await Question.find({ _id: { $in: qIds } }).select(
    "_id type correctAnswer marks"
  );

  const qMap = new Map(questions.map((q) => [q._id.toString(), q]));

  let totalScore = 0;
  let hasSubjective = false;

  attempt.answers = attempt.answers.map((ans) => {
    const q = qMap.get(ans.questionId.toString());
    if (!q) return ans;

    if (q.type === "MCQ" || q.type === "TRUE_FALSE") {
      const studentAnswer = ans.selectedOption ?? ans.textAnswer;
      const isCorrect = studentAnswer === q.correctAnswer;

      ans.isCorrect = isCorrect;
      ans.marksObtained = isCorrect ? (q.marks || 0) : 0;

      totalScore += ans.marksObtained;
      return ans;
    }

    if (q.type === "SHORT" || q.type === "LONG") {
      hasSubjective = true;
    }

    ans.isCorrect = null;
    ans.marksObtained = ans.marksObtained ?? 0;
    totalScore += ans.marksObtained;
    return ans;
  });

  attempt.totalScore = totalScore;
  attempt.percentage =
    attempt.maxScore && attempt.maxScore > 0
      ? Math.round((totalScore / attempt.maxScore) * 100)
      : 0;

  if (hasSubjective) {
    attempt.status = "SUBMITTED";
    attempt.resultStatus = null;
  } else {
    attempt.status = "EVALUATED";
    attempt.resultStatus =
      attempt.percentage >= PASS_PERCENTAGE ? "PASS" : "FAIL";
  }

  await attempt.save();
  return attempt;
};