import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import {
  calculateAttemptQuestionMetrics,
  normalizeDifficulty,
  createEmptyDifficultyBreakdown,
  hasAnswerValue,
} from "../../src/modules/test-attempts/utils/attemptQuestionMetrics.util.js";

import {
  buildAttemptAnalyticsSnapshot,
  isValidSnapshot,
} from "../../src/modules/test-attempts/utils/attemptAnalyticsSnapshot.util.js";

import {
  resolveAttemptAnalyticsMetadata,
} from "../../src/services/analyticsSummary.service.js";

function runB2Verification() {
  console.log("=== Running Phase B2 Unit & Parity Verification Checklist ===\n");
  const results = [];

  const testMeta = {
    title: "Parity Test",
    type: "Standard",
    subjectIds: [{ name: "Computer Science" }],
    topicIds: [{ name: "Algorithms" }],
  };

  // 1. Direct Parity Test: Same attempt passed to snapshot and shared metrics
  const diffMap = new Map([
    ["q1", "Easy"],
    ["q2", "Hard"],
    ["q3", "Medium"],
    ["q4", null], // missing difficulty -> Medium
  ]);

  const complexAttempt = {
    _id: "attempt123",
    studentId: "student123",
    testId: "test123",
    totalScore: 50,
    percentage: 50,
    timeTakenSeconds: 120,
    questionSnapshots: [
      { questionId: "q1", difficulty: "Easy" },
      { questionId: "q2", difficulty: "Hard" },
      { questionId: "q3", difficulty: "Medium" },
      { questionId: "q4" }, // no diff in snapshot or map -> Medium
      { questionId: "q5", difficulty: "Easy" }, // unanswered, no answer record
    ],
    answers: [
      { questionId: "q1", selectedOption: "0", isCorrect: true }, // option "0"
      { questionId: "q2", textAnswer: "wrong solution", isCorrect: false }, // text wrong
      { questionId: "q3", textAnswer: "pending essay", isCorrect: null }, // pending subjective
      { questionId: "q4", textAnswer: "   ", isCorrect: false }, // whitespace only -> skipped
      // q5 has no answer record
    ],
  };

  const sharedMetrics = calculateAttemptQuestionMetrics({
    answers: complexAttempt.answers,
    questionSnapshots: complexAttempt.questionSnapshots,
    questionDifficultyMap: diffMap,
  });

  const snapshot = buildAttemptAnalyticsSnapshot({
    attempt: complexAttempt,
    test: testMeta,
    questionDifficultyMap: diffMap,
  });

  // Verify breakdown parity between sharedMetrics and snapshot
  const breakdownParity = JSON.stringify(sharedMetrics.difficultyBreakdown) === JSON.stringify(snapshot.difficultyBreakdown);

  results.push({
    test: "1. Direct Parity: calculateAttemptQuestionMetrics and buildAttemptAnalyticsSnapshot yield identical difficultyBreakdown",
    passed: breakdownParity && isValidSnapshot(snapshot),
    details: `Parity: ${breakdownParity}, Valid snapshot: ${isValidSnapshot(snapshot)}`,
  });

  // 2. Metric counts verification on the complex attempt
  // q1: Easy, correct (option "0")
  // q2: Hard, wrong (text)
  // q3: Medium, pending (essay, isCorrect: null)
  // q4: Medium, skipped (whitespace)
  // q5: Easy, skipped (unanswered, missing from answers)
  const expectedCounts = {
    correct: 1,
    wrong: 1,
    skipped: 2,
    pending: 1,
    evaluatedCount: 2,
    answeredCount: 3,
    totalQuestions: 5,
    accuracy: 50,
  };

  const countsMatch =
    sharedMetrics.correct === expectedCounts.correct &&
    sharedMetrics.wrong === expectedCounts.wrong &&
    sharedMetrics.skipped === expectedCounts.skipped &&
    sharedMetrics.pending === expectedCounts.pending &&
    sharedMetrics.evaluatedCount === expectedCounts.evaluatedCount &&
    sharedMetrics.answeredCount === expectedCounts.answeredCount &&
    sharedMetrics.totalQuestions === expectedCounts.totalQuestions &&
    sharedMetrics.accuracy === expectedCounts.accuracy;

  results.push({
    test: "2. Canonical question metrics match expected breakdown (correct: 1, wrong: 1, skipped: 2, pending: 1, acc: 50%)",
    passed: countsMatch,
    details: `correct: ${sharedMetrics.correct}, wrong: ${sharedMetrics.wrong}, skipped: ${sharedMetrics.skipped}, pending: ${sharedMetrics.pending}, accuracy: ${sharedMetrics.accuracy}%`,
  });

  // 3. Option 0 and numeric 0
  const optZeroMetrics = calculateAttemptQuestionMetrics({
    answers: [
      { questionId: "s0", selectedOption: "0", isCorrect: true },
      { questionId: "n0", selectedOption: 0, isCorrect: false },
    ],
    questionSnapshots: [{ questionId: "s0" }, { questionId: "n0" }],
  });
  results.push({
    test: "3. Option '0' and numeric 0 both count as answered",
    passed: optZeroMetrics.correct === 1 && optZeroMetrics.wrong === 1 && optZeroMetrics.skipped === 0,
    details: `correct: ${optZeroMetrics.correct}, wrong: ${optZeroMetrics.wrong}, skipped: ${optZeroMetrics.skipped}`,
  });

  // 4. Whitespace-only text counted as skipped
  const wsMetrics = calculateAttemptQuestionMetrics({
    answers: [{ questionId: "ws", textAnswer: "  \n  ", isCorrect: false }],
    questionSnapshots: [{ questionId: "ws" }],
  });
  results.push({
    test: "4. Whitespace-only text counted as skipped",
    passed: wsMetrics.skipped === 1 && wsMetrics.wrong === 0,
    details: `skipped: ${wsMetrics.skipped}, wrong: ${wsMetrics.wrong}`,
  });

  // 5. Non-empty answer with isCorrect: null is counted as pending only
  const pendMetrics = calculateAttemptQuestionMetrics({
    answers: [{ questionId: "p", textAnswer: "essay", isCorrect: null }],
    questionSnapshots: [{ questionId: "p" }],
  });
  results.push({
    test: "5. Non-empty answer with isCorrect: null counted as pending only (not skipped, not wrong)",
    passed: pendMetrics.pending === 1 && pendMetrics.skipped === 0 && pendMetrics.wrong === 0 && pendMetrics.evaluatedCount === 0 && pendMetrics.accuracy === 0,
    details: `pending: ${pendMetrics.pending}, skipped: ${pendMetrics.skipped}, wrong: ${pendMetrics.wrong}, accuracy: ${pendMetrics.accuracy}`,
  });

  // 6. Missing or invalid difficulty counted under Medium
  const noDiffMetrics = calculateAttemptQuestionMetrics({
    answers: [
      { questionId: "x1", selectedOption: "A", isCorrect: true },
      { questionId: "x2", selectedOption: "B", isCorrect: false },
    ],
    questionSnapshots: [
      { questionId: "x1", difficulty: "INVALID_DIFF" },
      { questionId: "x2" }, // no diff
    ],
    questionDifficultyMap: new Map(), // empty map
  });
  results.push({
    test: "6. Missing or invalid difficulty normalized to Medium",
    passed: noDiffMetrics.difficultyBreakdown.Medium.correct === 1 && noDiffMetrics.difficultyBreakdown.Medium.wrong === 1,
    details: `Medium.correct: ${noDiffMetrics.difficultyBreakdown.Medium.correct}, Medium.wrong: ${noDiffMetrics.difficultyBreakdown.Medium.wrong}`,
  });

  // 7. Empty attempt produces zeros with numeric accuracy 0 (no NaN)
  const emptyMetrics = calculateAttemptQuestionMetrics({
    answers: [],
    questionSnapshots: [],
  });
  results.push({
    test: "7. Empty attempt produces zero counts and numeric accuracy 0",
    passed: emptyMetrics.totalQuestions === 0 && emptyMetrics.accuracy === 0 && typeof emptyMetrics.accuracy === "number",
    details: `total: ${emptyMetrics.totalQuestions}, accuracy: ${emptyMetrics.accuracy}`,
  });

  // 8. Unanswered question missing from answers array but present in snapshots
  const missingAnsMetrics = calculateAttemptQuestionMetrics({
    answers: [],
    questionSnapshots: [{ questionId: "unans1" }, { questionId: "unans2" }],
  });
  results.push({
    test: "8. Questions present in snapshots but absent from answers count as skipped",
    passed: missingAnsMetrics.skipped === 2 && missingAnsMetrics.totalQuestions === 2,
    details: `skipped: ${missingAnsMetrics.skipped}, total: ${missingAnsMetrics.totalQuestions}`,
  });

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll B2 Unit & Parity Verification Tests Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

runB2Verification();
