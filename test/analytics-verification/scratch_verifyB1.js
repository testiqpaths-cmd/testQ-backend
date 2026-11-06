import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import {
  buildAttemptAnalyticsSnapshot,
  isValidSnapshot,
} from "../../src/modules/test-attempts/utils/attemptAnalyticsSnapshot.util.js";

function runB1Verification() {
  console.log("=== Running Phase B1 Unit Verification Checklist ===\n");
  const results = [];

  const testMeta = {
    title: "Snapshot Test",
    type: "Standard",
    subjectIds: [{ name: "Computer Science" }],
    topicIds: [{ name: "Algorithms" }],
  };

  // Test 1: questionSnapshots present with missing answer records
  // 3 questions in snapshot: q1 answered correct, q2 answered wrong, q3 has NO answer record
  const diffMap1 = new Map([
    ["q1", "Easy"],
    ["q2", "Hard"],
    ["q3", "Medium"],
  ]);
  const attempt1 = {
    questionSnapshots: [
      { questionId: "q1" },
      { questionId: "q2" },
      { questionId: "q3" },
    ],
    answers: [
      { questionId: "q1", selectedOption: "A", isCorrect: true },
      { questionId: "q2", selectedOption: "B", isCorrect: false },
      // q3 omitted completely from answers
    ],
  };
  const snapshot1 = buildAttemptAnalyticsSnapshot({
    attempt: attempt1,
    test: testMeta,
    questionDifficultyMap: diffMap1,
  });

  const b1 = snapshot1.difficultyBreakdown;
  const totalQuestions1 =
    b1.Easy.correct + b1.Easy.wrong + b1.Easy.skipped +
    b1.Medium.correct + b1.Medium.wrong + b1.Medium.skipped +
    b1.Hard.correct + b1.Hard.wrong + b1.Hard.skipped;

  const valid1 = isValidSnapshot(snapshot1);
  results.push({
    test: "1. questionSnapshots present with missing answer record for q3",
    passed: totalQuestions1 === 3 && b1.Easy.correct === 1 && b1.Hard.wrong === 1 && b1.Medium.skipped === 1 && valid1,
    details: `total: ${totalQuestions1} (expected 3), Easy.correct: ${b1.Easy.correct}, Hard.wrong: ${b1.Hard.wrong}, Medium.skipped: ${b1.Medium.skipped}, valid: ${valid1}`,
  });

  // Test 2: attempt with NO questionSnapshots at all, only answers
  const diffMap2 = new Map([
    ["qA", "Easy"],
    ["qB", "Medium"],
  ]);
  const attempt2 = {
    answers: [
      { questionId: "qA", selectedOption: "C", isCorrect: true },
      { questionId: "qB", selectedOption: "D", isCorrect: false },
    ],
  };
  const snapshot2 = buildAttemptAnalyticsSnapshot({
    attempt: attempt2,
    test: testMeta,
    questionDifficultyMap: diffMap2,
  });
  const b2 = snapshot2.difficultyBreakdown;
  const totalQuestions2 =
    b2.Easy.correct + b2.Easy.wrong + b2.Easy.skipped +
    b2.Medium.correct + b2.Medium.wrong + b2.Medium.skipped +
    b2.Hard.correct + b2.Hard.wrong + b2.Hard.skipped;

  results.push({
    test: "2. Attempt with NO questionSnapshots, only answers",
    passed: totalQuestions2 === 2 && b2.Easy.correct === 1 && b2.Medium.wrong === 1 && isValidSnapshot(snapshot2),
    details: `total: ${totalQuestions2} (expected 2), Easy.correct: ${b2.Easy.correct}, Medium.wrong: ${b2.Medium.wrong}`,
  });

  // Test 3: Option "0" and numeric 0 count as answered
  const attempt3 = {
    questionSnapshots: [{ questionId: "qStr0" }, { questionId: "qNum0" }],
    answers: [
      { questionId: "qStr0", selectedOption: "0", isCorrect: true },
      { questionId: "qNum0", selectedOption: 0, isCorrect: true },
    ],
  };
  const diffMap3 = new Map([
    ["qStr0", "Easy"],
    ["qNum0", "Easy"],
  ]);
  const snapshot3 = buildAttemptAnalyticsSnapshot({
    attempt: attempt3,
    test: testMeta,
    questionDifficultyMap: diffMap3,
  });
  const b3 = snapshot3.difficultyBreakdown;
  results.push({
    test: "3. Option '0' and numeric 0 count as answered (not skipped)",
    passed: b3.Easy.correct === 2 && b3.Easy.skipped === 0,
    details: `Easy.correct: ${b3.Easy.correct}, Easy.skipped: ${b3.Easy.skipped}`,
  });

  // Test 4: Non-empty text response with isCorrect: false counts as wrong
  const attempt4 = {
    questionSnapshots: [{ questionId: "qTextWrong" }],
    answers: [
      { questionId: "qTextWrong", textAnswer: "some code solution", isCorrect: false },
    ],
  };
  const diffMap4 = new Map([["qTextWrong", "Hard"]]);
  const snapshot4 = buildAttemptAnalyticsSnapshot({
    attempt: attempt4,
    test: testMeta,
    questionDifficultyMap: diffMap4,
  });
  const b4 = snapshot4.difficultyBreakdown;
  results.push({
    test: "4. Non-empty text answer with isCorrect: false counts as wrong",
    passed: b4.Hard.wrong === 1 && b4.Hard.skipped === 0,
    details: `Hard.wrong: ${b4.Hard.wrong}, Hard.skipped: ${b4.Hard.skipped}`,
  });

  // Test 5: Text answer with whitespace only counts as skipped
  const attempt5 = {
    questionSnapshots: [{ questionId: "qWhitespace" }],
    answers: [
      { questionId: "qWhitespace", textAnswer: "   \n\t  ", isCorrect: false },
    ],
  };
  const diffMap5 = new Map([["qWhitespace", "Medium"]]);
  const snapshot5 = buildAttemptAnalyticsSnapshot({
    attempt: attempt5,
    test: testMeta,
    questionDifficultyMap: diffMap5,
  });
  const b5 = snapshot5.difficultyBreakdown;
  results.push({
    test: "5. Whitespace-only text answer counts as skipped (not wrong)",
    passed: b5.Medium.skipped === 1 && b5.Medium.wrong === 0,
    details: `Medium.skipped: ${b5.Medium.skipped}, Medium.wrong: ${b5.Medium.wrong}`,
  });

  // Test 6: Non-empty answer with isCorrect: null (pending subjective answer)
  const attempt6 = {
    questionSnapshots: [{ questionId: "qPending" }],
    answers: [
      { questionId: "qPending", textAnswer: "My thoughtful essay", isCorrect: null },
    ],
  };
  const diffMap6 = new Map([["qPending", "Hard"]]);
  const snapshot6 = buildAttemptAnalyticsSnapshot({
    attempt: attempt6,
    test: testMeta,
    questionDifficultyMap: diffMap6,
  });
  const b6 = snapshot6.difficultyBreakdown;
  results.push({
    test: "6. Non-empty answer with isCorrect: null is neither wrong nor skipped",
    passed: b6.Hard.correct === 0 && b6.Hard.wrong === 0 && b6.Hard.skipped === 0,
    details: `Hard.correct: ${b6.Hard.correct}, Hard.wrong: ${b6.Hard.wrong}, Hard.skipped: ${b6.Hard.skipped}`,
  });

  // Test 7: Missing difficulty in map consistently maps to Medium
  const attempt7 = {
    questionSnapshots: [{ questionId: "qNoDiff" }],
    answers: [
      { questionId: "qNoDiff", selectedOption: "A", isCorrect: true },
    ],
  };
  // Empty difficulty map
  const snapshot7 = buildAttemptAnalyticsSnapshot({
    attempt: attempt7,
    test: testMeta,
    questionDifficultyMap: new Map(),
  });
  const b7 = snapshot7.difficultyBreakdown;
  results.push({
    test: "7. Missing question difficulty defaults to Medium bucket",
    passed: b7.Medium.correct === 1 && b7.Easy.correct === 0 && b7.Hard.correct === 0,
    details: `Medium.correct: ${b7.Medium.correct}, Easy.correct: ${b7.Easy.correct}`,
  });

  // Test 8: isValidSnapshot returns true for valid snapshots
  results.push({
    test: "8. isValidSnapshot validation returns true for generated snapshot",
    passed: isValidSnapshot(snapshot1) && isValidSnapshot(snapshot3) && isValidSnapshot(snapshot7),
    details: `all valid: ${isValidSnapshot(snapshot1) && isValidSnapshot(snapshot3) && isValidSnapshot(snapshot7)}`,
  });

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll B1 Unit Verification Tests Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

runB1Verification();
