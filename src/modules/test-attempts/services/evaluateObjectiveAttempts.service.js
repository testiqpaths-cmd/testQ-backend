import TestAttempt from "../models/testAttempt.model.js";
import Question from "../../../models/question.model.js";
import Notification from "../../../modules/notification/notification.model.js";
import Test from "../../../models/test.model.js";
import { buildAttemptAnalyticsSnapshot } from "../utils/attemptAnalyticsSnapshot.util.js";

// Serialize analytics summary transactions so concurrent test submissions never
// contend on the shared PlatformDailySummary document and abort each other.
let analyticsQueueTail = Promise.resolve();
const enqueueAttemptAnalytics = (attemptId) => {
  const run = async () => {
    try {
      const { processCompletedAttemptAnalytics } = await import(
        "../../../services/analyticsSummary.service.js"
      );
      await processCompletedAttemptAnalytics(attemptId);
    } catch (err) {
      console.error("Failed to process analytics summary for attempt:", attemptId, err);
    }
  };

  analyticsQueueTail = analyticsQueueTail.then(run, run);
  return analyticsQueueTail;
};

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

// Difficulty lookup for every question in the attempt — including ones the
// student skipped. Skipped questions have no answer entry, and question
// snapshots don't store difficulty, so building this from answers alone made
// every skipped question fall back to "Medium" in the difficulty analysis.
const buildQuestionDifficultyMap = async (attempt) => {
  const ids = new Set();
  (attempt.answers || []).forEach((a) => a?.questionId && ids.add(String(a.questionId)));
  (attempt.questionSnapshots || []).forEach((q) => q?.questionId && ids.add(String(q.questionId)));
  if (ids.size === 0) return new Map();

  const docs = await Question.find({ _id: { $in: Array.from(ids) } })
    .select("_id difficulty")
    .lean();
  return new Map(docs.map((q) => [String(q._id), q.difficulty]));
};

export const evaluateObjectiveForAttempt = async (attemptId) => {
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt) return null;

  // only run after submission (or re-run if already evaluated or expired)
  if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED" && attempt.status !== "EXPIRED") {
    return attempt;
  }

  // Each database round trip is slow, so the reads below that do not depend on
  // each other are started together instead of one after another.
  const testPromise = Test.findById(attempt.testId)
    .populate("topicIds", "name")
    .populate("subjectIds", "name")
    .populate("subjectId", "name")
    .lean();

  // If no answers, don't mark evaluated (could be subjective test with no answers too)
  if (!attempt.answers || attempt.answers.length === 0) {
    const test = await testPromise;
    attempt.totalScore = 0;
    attempt.percentage = 0;
    updateAttemptStats(attempt);
    // keep it SUBMITTED so manual evaluation can happen if needed
    attempt.status = "SUBMITTED";
    attempt.analyticsSnapshot = buildAttemptAnalyticsSnapshot({
      attempt,
      test,
      questionDifficultyMap: await buildQuestionDifficultyMap(attempt),
    });
    await attempt.save();
    return attempt;
  }



  const qIds = attempt.answers.map((a) => a.questionId);
  const [test, questions, questionDifficultyMap] = await Promise.all([
    testPromise,
    Question.find({ _id: { $in: qIds } }).select("_id type correctAnswer difficulty"),
    buildQuestionDifficultyMap(attempt),
  ]);

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

      // A cleared/skipped question (entry exists but holds no answer) is
      // unattempted, not incorrect.
      ans.isCorrect = answerHasValue(ans) ? isCorrect : null;
      
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

  // The assignment sync and the attempt save are independent writes, so they run together.
  const syncAssignment = async () => {
    if (attempt.iqRoomId) return;
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
  };
  await Promise.all([syncAssignment(), attempt.save()]);

  // After the attempt is saved, the company track progress update (reads attempts,
  // writes the track attempt) and the analytics summary update (writes analytics
  // records) do not depend on each other, so they run together. Both still finish
  // before this function returns, and each handles its own errors as before.
  const updateTrackProgress = async () => {
    if (!(attempt.testCategory === "COMPANY" || attempt.companyTrackAttemptId || attempt.companyTrackId)) return;
    try {
      const { updateTrackAttemptProgress } = await import("../../company-exams/companyExam.service.js");
      await updateTrackAttemptProgress(attempt);
    } catch (err) {
      console.error("Failed to update company track progress in evaluateObjectiveForAttempt:", err);
    }
  };
  // Record attempt in pre-aggregated analytics summaries (serialized in background
  // outside NODE_ENV=test so concurrent submits don't abort on PlatformDailySummary locks)
  if (process.env.NODE_ENV === "test") {
    await Promise.all([updateTrackProgress(), enqueueAttemptAnalytics(attempt._id)]);
  } else {
    enqueueAttemptAnalytics(attempt._id);
    await updateTrackProgress();
  }

  return attempt;
};

