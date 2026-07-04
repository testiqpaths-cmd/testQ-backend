import TestAttempt from "../../../models/testAttempt.model.js";
import Question from "../../../models/question.model.js";
import Notification from "../../../modules/notification/notification.model.js";
import Test from "../../../models/test.model.js";

const PASS_PERCENTAGE = 40;

const normalizeValue = (value) => String(value ?? "").trim().toLowerCase();

const answerHasValue = (answer) =>
  (answer?.selectedOption !== undefined && answer?.selectedOption !== null) ||
  (answer?.textAnswer !== undefined && answer?.textAnswer !== null);

const updateAttemptStats = (attempt) => {
  const answers = attempt.answers || [];
  const totalQuestions = attempt.questionSnapshots?.length || answers.length;
  const attemptedCount = answers.filter(answerHasValue).length;
  const correctAnswersCount = answers.filter((answer) => answer.isCorrect === true).length;
  const incorrectAnswersCount = answers.filter((answer) => answer.isCorrect === false).length;
  const timeSpentMs = (attempt.questionSnapshots || []).reduce(
    (sum, question) => sum + (question.timeSpentMs || 0),
    0,
  );

  attempt.correctAnswersCount = correctAnswersCount;
  attempt.incorrectAnswersCount = incorrectAnswersCount;
  attempt.unattemptedCount = Math.max(0, totalQuestions - attemptedCount);
  attempt.accuracy = attemptedCount > 0 ? (correctAnswersCount / attemptedCount) * 100 : 0;
  attempt.timeTakenSeconds = Math.round(timeSpentMs / 1000);
};

const resolveStudentAnswer = (answer, snapshot) => {
  if (answer?.selectedOption !== undefined && answer?.selectedOption !== null) {
    const selectedOption = answer.selectedOption;

    if (Number.isInteger(selectedOption) && Array.isArray(snapshot?.options)) {
      return snapshot.options[selectedOption] ?? null;
    }

    const numericIndex = Number(selectedOption);
    if (Number.isInteger(numericIndex) && Array.isArray(snapshot?.options)) {
      return snapshot.options[numericIndex] ?? null;
    }

    return selectedOption;
  }

  return answer?.textAnswer ?? null;
};

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
    updateAttemptStats(attempt);
    // keep it SUBMITTED so manual evaluation can happen if needed
    attempt.status = "SUBMITTED";
    await attempt.save();
    return attempt;
  }

  if (attempt.expireReason === "CHEATING") {
    attempt.totalScore = 0;
    attempt.percentage = 0;
    updateAttemptStats(attempt);
    attempt.status = "EVALUATED";
    attempt.resultStatus = "FAIL";
    await attempt.save();
    return attempt;
  }

  const qIds = attempt.answers.map((a) => a.questionId);
  const questions = await Question.find({ _id: { $in: qIds } }).select(
    "_id type correctAnswer"
  );

  const qMap = new Map(questions.map((q) => [q._id.toString(), q]));
  const snapshotMap = new Map(
    (attempt.questionSnapshots || []).map((snapshot) => [
      snapshot.questionId.toString(),
      snapshot,
    ]),
  );

  let totalScore = 0;
  let hasSubjective = false;

  attempt.answers = attempt.answers.map((ans) => {
    const snapshot = snapshotMap.get(ans.questionId.toString());
    const q = snapshot || qMap.get(ans.questionId.toString());
    if (!q) return ans;

    if (q.type === "MCQ" || q.type === "TRUE_FALSE") {
      const studentAnswer = resolveStudentAnswer(ans, snapshot || q);
      const isCorrect = normalizeValue(studentAnswer) === normalizeValue(q.correctAnswer);

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
  updateAttemptStats(attempt);

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
