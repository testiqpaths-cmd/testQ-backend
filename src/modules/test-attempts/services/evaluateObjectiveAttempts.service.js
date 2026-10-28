import TestAttempt from "../../../models/testAttempt.model.js";
import Question from "../../../models/question.model.js";
import Notification from "../../../modules/notification/notification.model.js";
import Test from "../../../models/test.model.js";
import { buildAttemptAnalyticsSnapshot } from "../utils/attemptAnalyticsSnapshot.util.js";

const normalizeValue = (value) => String(value ?? "").trim().toLowerCase();

const answerHasValue = (answer) => {
  const hasSelectedOption =
    answer?.selectedOption !== undefined &&
    answer?.selectedOption !== null &&
    String(answer.selectedOption).trim() !== "";

  const hasTextAnswer =
    answer?.textAnswer !== undefined &&
    answer?.textAnswer !== null &&
    String(answer.textAnswer).trim() !== "";

  return hasSelectedOption || hasTextAnswer;
};

const updateAttemptStats = (attempt) => {
  const answers = attempt.answers || [];
  const totalQuestions =
    attempt.questionSnapshots?.length || answers.length;

  const attemptedCount = answers.filter(answerHasValue).length;

  const correctAnswersCount = answers.filter(
    (answer) =>
      answerHasValue(answer) && answer.isCorrect === true
  ).length;

  const incorrectAnswersCount = answers.filter(
    (answer) =>
      answerHasValue(answer) && answer.isCorrect === false
  ).length;

  const timeSpentMs = (attempt.questionSnapshots || []).reduce(
    (sum, question) => sum + (question.timeSpentMs || 0),
    0,
  );

  const evaluatedObjectiveCount =
    correctAnswersCount + incorrectAnswersCount;

  attempt.correctAnswersCount = correctAnswersCount;
  attempt.incorrectAnswersCount = incorrectAnswersCount;

  attempt.unattemptedCount = Math.max(
    0,
    totalQuestions - attemptedCount,
  );

  attempt.accuracy =
    evaluatedObjectiveCount > 0
      ? (correctAnswersCount / evaluatedObjectiveCount) * 100
      : 0;

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

  const test = await Test.findById(attempt.testId)
    .populate("topicIds", "name")
    .populate("subjectIds", "name")
    .populate("subjectId", "name")
    .lean();

  // only run after submission (or re-run if already evaluated or expired)
  if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED" && attempt.status !== "EXPIRED") {
    return attempt;
  }

  // If no answers, don't mark evaluated (could be subjective test with no answers too)
  if (!attempt.answers || attempt.answers.length === 0) {
    attempt.totalScore = 0;
    attempt.percentage = 0;
    updateAttemptStats(attempt);
    // keep it SUBMITTED so manual evaluation can happen if needed
    attempt.status = "SUBMITTED";
    attempt.analyticsSnapshot = buildAttemptAnalyticsSnapshot({
      attempt,
      test,
      questionDifficultyMap: new Map(),
    });
    await attempt.save();
    return attempt;
  }



  const qIds = attempt.answers.map((a) => a.questionId);
  const questions = await Question.find({ _id: { $in: qIds } }).select(
    "_id type correctAnswer difficulty"
  );
  const questionDifficultyMap = new Map(
    questions.map((q) => [String(q._id), q.difficulty])
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
      
      const marksForQ = test?.marksPerQuestion || q.marks || 1;
      const negPercentage = test?.negativeMarkingPercentage || 0;

      if (isCorrect) {
        ans.marksObtained = marksForQ;
      } else if (answerHasValue(ans)) {
        // Incorrect but attempted
        ans.marksObtained = -(marksForQ * (negPercentage / 100));
      } else {
        // Unattempted
        ans.marksObtained = 0;
      }

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
  const rawPercentage =
    attempt.maxScore && attempt.maxScore > 0
      ? (totalScore / attempt.maxScore) * 100
      : 0;
  attempt.percentage = Math.round(rawPercentage);
  updateAttemptStats(attempt);

  const passingThreshold =
    typeof test?.passingPercentage === "number"
      ? test.passingPercentage
      : 50;

  if (hasSubjective) {
    attempt.status = "SUBMITTED";
    attempt.resultStatus = attempt.expireReason === "CHEATING" ? "FAIL" : null;
    attempt.isCompleted = true;
    attempt.isPassed = false;
  } else {
    attempt.status = "EVALUATED";
    attempt.resultStatus =
      attempt.expireReason === "CHEATING"
        ? "FAIL"
        : rawPercentage >= passingThreshold
          ? "PASS"
          : "FAIL";
    attempt.isCompleted = true;
    attempt.isPassed = attempt.resultStatus === "PASS";
  }

  // Generate display-ready analytics snapshot for fast dashboard access
  attempt.analyticsSnapshot = buildAttemptAnalyticsSnapshot({
    attempt,
    test,
    questionDifficultyMap,
  });

  if (!attempt.iqRoomId) {
    try {
      const TestAssignment = (await import("../../../models/testAssignment.model.js")).default;
      await TestAssignment.updateOne(
        { testId: attempt.testId, studentId: attempt.studentId },
        {
          $set: {
            status: "SUBMITTED",
            submittedAt: attempt.submittedAt || new Date(),
            score: attempt.totalScore ?? 0,
          },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error("Failed to sync TestAssignment during evaluateObjectiveForAttempt:", err);
    }
  }

  await attempt.save();

  if (attempt.testCategory === "COMPANY" || attempt.companyTrackAttemptId || attempt.companyTrackId) {
    try {
      const { updateTrackAttemptProgress } = await import("../../company-exams/companyExam.service.js");
      await updateTrackAttemptProgress(attempt);
    } catch (err) {
      console.error("Failed to update company track progress in evaluateObjectiveForAttempt:", err);
    }
  }

  // Record attempt in pre-aggregated analytics summaries (idempotent & non-blocking)
  try {
    const { processCompletedAttemptAnalytics } = await import("../../../services/analyticsSummary.service.js");
    await processCompletedAttemptAnalytics(attempt._id);
  } catch (err) {
    console.error("Failed to process analytics summary for attempt:", attempt._id, err);
  }

  return attempt;
};

