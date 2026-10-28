import TestAttempt from "../../../models/testAttempt.model.js";
import Question from "../../../models/question.model.js"; // adjust to your actual path
import Notification from "../../../modules/notification/notification.model.js";
import Test from "../../../models/test.model.js";
import { buildAttemptAnalyticsSnapshot } from "../utils/attemptAnalyticsSnapshot.util.js";

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

export const manualEvaluateAttempt = async (attemptId, evaluations) => {
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt) return { error: "Attempt not found", status: 404 };

  // ✅ Only evaluate after submission (recommended)
  if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED") {
    return {
      error: `Cannot evaluate attempt in status ${attempt.status}`,
      status: 409,
    };
  }

  const test = await Test.findById(attempt.testId)
    .populate("topicIds", "name")
    .populate("subjectIds", "name")
    .populate("subjectId", "name")
    .lean();



  // Load questions for evaluation items
  const qMap = new Map(
    (attempt.questionSnapshots || []).map((snapshot) => [
      snapshot.questionId.toString(),
      snapshot,
    ])
  );

  // Apply evaluations
  for (const ev of evaluations) {
    const q = qMap.get(ev.questionId);
    if (!q)
      return { error: `Question not found: ${ev.questionId}`, status: 400 };

    // ✅ Subjective only
    if (q.type !== "SHORT" && q.type !== "LONG") {
      return {
        error: `Manual evaluation allowed only for SHORT/LONG. Found ${q.type} for ${ev.questionId}`,
        status: 400,
      };
    }

    // ✅ marks validation against question.marks
    if (ev.marksObtained > (q.marks ?? 0)) {
      return {
        error: `marksObtained exceeds max marks (${q.marks}) for question ${ev.questionId}`,
        status: 400,
      };
    }

    // Find answer in attempt
    const idx = attempt.answers.findIndex(
      (a) => a.questionId.toString() === ev.questionId,
    );
    if (idx === -1) {
      return {
        error: `Answer not found in attempt for question ${ev.questionId}`,
        status: 400,
      };
    }

    attempt.answers[idx].marksObtained = ev.marksObtained;
    attempt.answers[idx].feedback =
      ev.feedback ?? attempt.answers[idx].feedback ?? null;

    // subjective correctness stays null (or you can set true/false if your org wants)
    attempt.answers[idx].isCorrect = null;
  }

  // ✅ SCRUM-23: Recompute totals
  const totalScore = (attempt.answers || []).reduce(
    (sum, a) => sum + (a.marksObtained || 0),
    0,
  );

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

  attempt.resultStatus =
    attempt.expireReason === "CHEATING"
      ? "FAIL"
      : rawPercentage >= passingThreshold
        ? "PASS"
        : "FAIL";

  attempt.isPassed = attempt.resultStatus === "PASS";
  attempt.status = "EVALUATED";

  try {
    const qIds = (attempt.answers || []).map((a) => a.questionId).filter(Boolean);
    const questions = await Question.find({ _id: { $in: qIds } }).select("_id difficulty").lean();
    const questionDifficultyMap = new Map(questions.map((q) => [String(q._id), q.difficulty]));
    attempt.analyticsSnapshot = buildAttemptAnalyticsSnapshot({
      attempt,
      test,
      questionDifficultyMap,
    });
  } catch (snapshotErr) {
    console.error("Failed to refresh analyticsSnapshot during manual evaluation:", snapshotErr);
  }

  await attempt.save();

  if (attempt.testCategory === "COMPANY" || attempt.companyTrackAttemptId || attempt.companyTrackId) {
    try {
      const { updateTrackAttemptProgress } = await import("../../company-exams/companyExam.service.js");
      await updateTrackAttemptProgress(attempt);
    } catch (err) {
      console.error("Failed to update company track progress in manualEvaluateAttempt:", err);
    }
  }

  // Record attempt in pre-aggregated analytics summaries (delta-aware & idempotent)
  try {
    const { processCompletedAttemptAnalytics } = await import("../../../services/analyticsSummary.service.js");
    await processCompletedAttemptAnalytics(attempt._id);
  } catch (err) {
    console.error("Failed to process analytics summary for manual attempt:", attempt._id, err);
  }

  // Dispatch notification to the student about the evaluation
  if (attempt.studentId) {
    await Notification.create({
      userId: attempt.studentId,
      title: "Test Evaluated",
      message: `Your test attempt for "${test?.title || 'a test'}" has been evaluated.`,
      type: "EVALUATION",
      link: `/student/dashboard/result/${attempt._id}`,
      metadata: { attemptId: attempt._id, testId: attempt.testId }
    });
  }

  return { attempt };
};
