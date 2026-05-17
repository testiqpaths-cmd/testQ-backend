import TestAttempt from "../../../models/testAttempt.model.js";

export const getAttemptResult = async (attemptId) => {
  // Populate questionId but DO NOT expose correctAnswer from DB
  // We'll use snapshots for correctAnswer (point-in-time capture)
  const attempt = await TestAttempt.findById(attemptId).populate({
    path: "testId",
    select: "title name duration totalQuestions testSeriesId createdBy totalMarks",
    populate: {
      path: "testSeriesId",
      select: "title description",
    },
  }).populate({
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

  const attemptObj = attempt.toObject ? attempt.toObject() : attempt;
  attemptObj.answers = enrichedAnswers;

  // Build analysis
  const totalQuestions = attemptObj.questionSnapshots?.length || enrichedAnswers.length;

  // Per-question correctness and timing
  const perQuestion = enrichedAnswers.map((a) => {
    const qId = a.questionId._id ? a.questionId._id.toString() : String(a.questionId);
    const snapshot = snapshotMap.get(qId) || {};
    const correct = (() => {
      if (snapshot.correctAnswer === undefined || snapshot.correctAnswer === null) return null;
      // Handle multichoice (array) or single
      if (Array.isArray(snapshot.correctAnswer)) {
        const selected = a.selectedOption || a.selectedOptions || [];
        // compare arrays by values
        return Array.isArray(selected) && selected.length
          ? selected.sort().toString() === snapshot.correctAnswer.sort().toString()
          : false;
      }
      return String(a.selectedOption ?? a.textAnswer ?? '') === String(snapshot.correctAnswer ?? '');
    })();

    const resolvedMarks = Number.isFinite(snapshot.marks) ? snapshot.marks : 0;
    const derivedMarksObtained =
      Number.isFinite(a.marksObtained) && a.marksObtained > 0
        ? a.marksObtained
        : ((a.isCorrect ?? correct) ? resolvedMarks : 0);

    return {
      questionId: qId,
      questionText: snapshot.questionText || a.questionId.questionText || '',
      selected: a.selectedOption ?? a.textAnswer ?? null,
      correctAnswer: snapshot.correctAnswer ?? null,
      isCorrect: a.isCorrect ?? correct,
      marks: resolvedMarks,
      marksObtained: derivedMarksObtained,
      timeSpentMs: a.timeSpentMs ?? 0,
    };
  });

  const derivedTotalScore = perQuestion.reduce((sum, q) => sum + (q.marksObtained || 0), 0);
  const snapshotMaxScore = (attemptObj.questionSnapshots || []).reduce(
    (sum, q) => sum + (Number.isFinite(q.marks) ? q.marks : 0),
    0
  );

  const totalScore =
    Number.isFinite(attemptObj.totalScore) && attemptObj.totalScore > 0
      ? attemptObj.totalScore
      : derivedTotalScore;
  const maxScore =
    Number.isFinite(attemptObj.maxScore) && attemptObj.maxScore > 0
      ? attemptObj.maxScore
      : snapshotMaxScore;
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  // Topic-wise and difficulty (if available in snapshots)
  const topicMap = new Map();
  (attemptObj.questionSnapshots || []).forEach((s) => {
    const topic = s.topic || 'Unknown';
    const stats = topicMap.get(topic) || { correct: 0, total: 0 };
    topicMap.set(topic, stats);
  });
  // Fill topic stats from perQuestion
  perQuestion.forEach((pq) => {
    const topic = (pq.topic || 'Unknown');
    const st = topicMap.get(topic) || { correct: 0, total: 0 };
    st.total += 1;
    if (pq.isCorrect) st.correct += 1;
    topicMap.set(topic, st);
  });

  const topicBreakdown = Array.from(topicMap.entries()).map(([topic, st]) => ({
    topic,
    correct: st.correct,
    total: st.total,
    accuracy: st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0,
  }));

  const analysis = {
    totalQuestions,
    totalScore,
    maxScore,
    percentage,
    perQuestion,
    topicBreakdown,
    submittedAt: attemptObj.submittedAt,
    evaluatedAt: attemptObj.evaluatedAt,
    resultStatus: attemptObj.resultStatus,
  };

  return {
    attempt: attemptObj,
    analysis,
  };
};
