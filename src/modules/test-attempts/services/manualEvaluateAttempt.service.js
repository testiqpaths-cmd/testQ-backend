import TestAttempt from "../../../models/testAttempt.model.js";
import Question from "../../../models/question.model.js"; // adjust to your actual path

export const manualEvaluateAttempt = async (attemptId, evaluations) => {
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt) return { error: "Attempt not found", status: 404 };

  // ✅ Only evaluate after submission (recommended)
  if (attempt.status !== "SUBMITTED" && attempt.status !== "EVALUATED") {
    return { error: `Cannot evaluate attempt in status ${attempt.status}`, status: 409 };
  }

  // Load questions for evaluation items
  const evalQIds = evaluations.map(e => e.questionId);
  const questions = await Question.find({ _id: { $in: evalQIds } })
    .select("_id type marks");

  const qMap = new Map(questions.map(q => [q._id.toString(), q]));

  // Apply evaluations
  for (const ev of evaluations) {
    const q = qMap.get(ev.questionId);
    if (!q) return { error: `Question not found: ${ev.questionId}`, status: 400 };

    // ✅ Subjective only
    if (q.type !== "SHORT" && q.type !== "LONG") {
      return { error: `Manual evaluation allowed only for SHORT/LONG. Found ${q.type} for ${ev.questionId}`, status: 400 };
    }

    // ✅ marks validation against question.marks
    if (ev.marksObtained > (q.marks ?? 0)) {
      return { error: `marksObtained exceeds max marks (${q.marks}) for question ${ev.questionId}`, status: 400 };
    }

    // Find answer in attempt
    const idx = attempt.answers.findIndex(a => a.questionId.toString() === ev.questionId);
    if (idx === -1) {
      return { error: `Answer not found in attempt for question ${ev.questionId}`, status: 400 };
    }

    attempt.answers[idx].marksObtained = ev.marksObtained;
    attempt.answers[idx].feedback = ev.feedback ?? attempt.answers[idx].feedback ?? null;

    // subjective correctness stays null (or you can set true/false if your org wants)
    attempt.answers[idx].isCorrect = null;
  }

  // Recompute totals
  const total = (attempt.answers || []).reduce((sum, a) => sum + (a.marksObtained || 0), 0);
  attempt.totalScore = total;
  attempt.percentage = attempt.maxScore && attempt.maxScore > 0
    ? Math.round((total / attempt.maxScore) * 100)
    : 0;

  // ✅ final status
  attempt.status = "EVALUATED";

  await attempt.save();
  return { attempt };
};
