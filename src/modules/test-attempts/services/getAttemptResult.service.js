import TestAttempt from "../../../models/testAttempt.model.js";

// A test is shared by every student assigned/attempting it — if one student
// finishes early and can already see the correct answers, they can pass them
// on to classmates still taking the same test, regardless of schedule type
// (IMMEDIATE tests can absolutely have several students mid-attempt at once,
// there's just no shared deadline forcing them to finish together).
//
// FIXED-schedule tests have an unambiguous "over" signal: the scheduled
// endTime. For IMMEDIATE/DELAYED tests there's no such deadline, so instead
// we check whether anyone else still has this test IN_PROGRESS right now —
// once nobody does, it's safe to reveal.
const isTestOverForEveryone = async (test, attemptId) => {
  if (!test) return true;

  if (test.scheduleType === "FIXED") {
    if (test.status === "COMPLETED") return true;
    return Boolean(test.endTime) && new Date() >= new Date(test.endTime);
  }

  const someoneStillAttempting = await TestAttempt.exists({
    testId: test._id,
    status: "IN_PROGRESS",
    _id: { $ne: attemptId },
  });
  return !someoneStillAttempting;
};

export const getAttemptResult = async (attemptId) => {
  // Populate questionId but DO NOT expose correctAnswer from DB
  // We'll use snapshots for correctAnswer (point-in-time capture)
  // Read-only — never saved. The code below already tolerates either a
  // Mongoose document or a plain lean object (`.toObject ? ... : ...`), so
  // .lean() just skips the unnecessary document-hydration cost.
  const attempt = await TestAttempt.findById(attemptId).populate({
    path: "testId",
    select: "title name duration totalQuestions testSeriesId createdBy totalMarks endTime scheduleType status",
    populate: {
      path: "testSeriesId",
      select: "title description",
    },
  }).populate({
    path: "answers.questionId",
    select: "questionText type options topic subTopic imageUrl", // ✅ no correctAnswer
  }).lean();

  if (!attempt) return null;

  const isTestOver = await isTestOverForEveryone(attempt.testId, attempt._id);

  // ✅ Enrich answers with correctAnswer from questionSnapshots
  const snapshotMap = new Map(
    (attempt.questionSnapshots || []).map((s) => [
      s.questionId.toString(),
      {
        correctAnswer: s.correctAnswer,
        questionText: s.questionText,
        options: s.options,
        marks: s.marks,
        imageUrl: s.imageUrl,
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
      imageUrl: snapshot.imageUrl ?? a.questionId.imageUrl ?? null,
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

  // Aggregate counts are safe to expose even while locked — knowing "you got
  // 6/10 correct" doesn't tell you (or anyone you might tell) WHICH question
  // or WHAT the correct answer was, unlike the per-question fields below.
  const correctCount = perQuestion.filter((q) => q.isCorrect === true).length;
  const incorrectCount = perQuestion.filter((q) => q.isCorrect === false).length;
  const unattemptedCount = perQuestion.filter((q) => q.isCorrect === null).length;

  // While the test is still open for other students, strip everything that
  // could reveal or imply the correct answer: the question text/options, the
  // correct answer itself, whether this attempt got it right, and the marks
  // awarded (full marks on an MCQ is itself a giveaway that the selected
  // option was correct).
  const perQuestionForResponse = isTestOver
    ? perQuestion
    : perQuestion.map((q) => ({
        questionId: q.questionId,
        questionText: null,
        imageUrl: null,
        selected: null,
        correctAnswer: null,
        isCorrect: null,
        marks: q.marks,
        marksObtained: null,
        timeSpentMs: q.timeSpentMs,
        locked: true,
      }));

  if (!isTestOver) {
    attemptObj.answers = (attemptObj.answers || []).map((a) => ({
      ...a,
      // `questionId` was populated with the real questionText/options — strip
      // it back down to a bare id rather than leaving the populated subdoc in
      // the response.
      questionId: a.questionId?._id || a.questionId,
      selectedOption: null,
      textAnswer: null,
      isCorrect: null,
      marksObtained: null,
    }));
    attemptObj.questionSnapshots = (attemptObj.questionSnapshots || []).map((s) => ({
      ...s,
      questionText: null,
      options: null,
      correctAnswer: null,
      imageUrl: null,
    }));
  }

  const analysis = {
    totalQuestions,
    totalScore,
    maxScore,
    percentage,
    correctCount,
    incorrectCount,
    unattemptedCount,
    perQuestion: perQuestionForResponse,
    topicBreakdown,
    submittedAt: attemptObj.submittedAt,
    evaluatedAt: attemptObj.evaluatedAt,
    resultStatus: attemptObj.resultStatus,
  };

  return {
    attempt: attemptObj,
    analysis,
    isTestOver,
  };
};
