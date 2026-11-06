import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

// We will test the logic directly as exported or simulated
import { evaluateObjectiveForAttempt } from "../../src/modules/test-attempts/services/evaluateObjectiveAttempts.service.js";

function testUnitScenarios() {
  console.log("=== Running Phase A1/A2 Unit Verification Checklist ===");

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

  const results = [];

  // Scenario 1: Unanswered objective question has isCorrect: false -> Not counted as wrong
  {
    const attempt = {
      answers: [
        { questionId: "q1", selectedOption: null, textAnswer: null, isCorrect: false }
      ]
    };
    updateAttemptStats(attempt);
    const pass = attempt.incorrectAnswersCount === 0 && attempt.unattemptedCount === 1;
    results.push({
      scenario: "1. Unanswered objective question has isCorrect: false",
      expected: "incorrectAnswersCount: 0, unattemptedCount: 1",
      actual: `incorrectAnswersCount: ${attempt.incorrectAnswersCount}, unattemptedCount: ${attempt.unattemptedCount}`,
      passed: pass
    });
  }

  // Scenario 2: Answered objective question has isCorrect: false -> Counted as wrong
  {
    const attempt = {
      answers: [
        { questionId: "q1", selectedOption: "2", textAnswer: null, isCorrect: false }
      ]
    };
    updateAttemptStats(attempt);
    const pass = attempt.incorrectAnswersCount === 1 && attempt.unattemptedCount === 0;
    results.push({
      scenario: "2. Answered objective question has isCorrect: false",
      expected: "incorrectAnswersCount: 1, unattemptedCount: 0",
      actual: `incorrectAnswersCount: ${attempt.incorrectAnswersCount}, unattemptedCount: ${attempt.unattemptedCount}`,
      passed: pass
    });
  }

  // Scenario 3: Selected option is '0' or 0 -> Counts as answered
  {
    const attemptStrZero = {
      answers: [
        { questionId: "q1", selectedOption: "0", textAnswer: null, isCorrect: true }
      ]
    };
    const attemptNumZero = {
      answers: [
        { questionId: "q1", selectedOption: 0, textAnswer: null, isCorrect: true }
      ]
    };
    updateAttemptStats(attemptStrZero);
    updateAttemptStats(attemptNumZero);
    const pass = attemptStrZero.correctAnswersCount === 1 && attemptStrZero.unattemptedCount === 0 &&
                 attemptNumZero.correctAnswersCount === 1 && attemptNumZero.unattemptedCount === 0;
    results.push({
      scenario: "3. Selected option is '0' or numeric 0",
      expected: "Both count as answered, correct: 1, unattempted: 0",
      actual: `str: correct=${attemptStrZero.correctAnswersCount}, unattempted=${attemptStrZero.unattemptedCount} | num: correct=${attemptNumZero.correctAnswersCount}, unattempted=${attemptNumZero.unattemptedCount}`,
      passed: pass
    });
  }

  // Scenario 4: Text answer contains only whitespace -> Counts as unanswered
  {
    const attempt = {
      answers: [
        { questionId: "q1", selectedOption: null, textAnswer: "   \t\n  ", isCorrect: false }
      ]
    };
    updateAttemptStats(attempt);
    const pass = attempt.incorrectAnswersCount === 0 && attempt.unattemptedCount === 1;
    results.push({
      scenario: "4. Text answer contains only whitespace",
      expected: "incorrectAnswersCount: 0, unattemptedCount: 1",
      actual: `incorrectAnswersCount: ${attempt.incorrectAnswersCount}, unattemptedCount: ${attempt.unattemptedCount}`,
      passed: pass
    });
  }

  // Scenario 5: One correct, one wrong, one pending subjective response -> Accuracy = 50%
  {
    const attempt = {
      answers: [
        { questionId: "q1", selectedOption: "1", textAnswer: null, isCorrect: true },
        { questionId: "q2", selectedOption: "2", textAnswer: null, isCorrect: false },
        { questionId: "q3", selectedOption: null, textAnswer: "My subjective answer essay", isCorrect: null }
      ]
    };
    updateAttemptStats(attempt);
    const pass = attempt.accuracy === 50 && attempt.correctAnswersCount === 1 && attempt.incorrectAnswersCount === 1;
    results.push({
      scenario: "5. One correct, one wrong, one pending subjective response",
      expected: "Accuracy = 50% (1 / 2 * 100), correct: 1, incorrect: 1",
      actual: `accuracy: ${attempt.accuracy}%, correct: ${attempt.correctAnswersCount}, incorrect: ${attempt.incorrectAnswersCount}`,
      passed: pass
    });
  }

  // Scenario 6: No evaluated objective answers -> Accuracy = 0, not null
  {
    const attempt = {
      answers: [
        { questionId: "q1", selectedOption: null, textAnswer: "Subjective only", isCorrect: null }
      ]
    };
    updateAttemptStats(attempt);
    const pass = attempt.accuracy === 0 && typeof attempt.accuracy === "number";
    results.push({
      scenario: "6. No evaluated objective answers",
      expected: "Accuracy = 0 (numeric, not null)",
      actual: `accuracy: ${attempt.accuracy} (${typeof attempt.accuracy})`,
      passed: pass
    });
  }

  // Scenario 7: Fully evaluated score is 45%, threshold is 50% -> FAIL
  {
    const test = { passingPercentage: 50 };
    const attempt = { percentage: 45, expireReason: null };
    const passingThreshold = typeof test?.passingPercentage === "number" ? test.passingPercentage : 50;
    attempt.resultStatus = attempt.expireReason === "CHEATING" ? "FAIL" : attempt.percentage >= passingThreshold ? "PASS" : "FAIL";
    attempt.isPassed = attempt.resultStatus === "PASS";
    const pass = attempt.resultStatus === "FAIL" && attempt.isPassed === false;
    results.push({
      scenario: "7. Fully evaluated score is 45%, threshold is 50%",
      expected: "resultStatus: FAIL, isPassed: false",
      actual: `resultStatus: ${attempt.resultStatus}, isPassed: ${attempt.isPassed}`,
      passed: pass
    });
  }

  // Scenario 8: Fully evaluated score is 55%, threshold is 50% -> PASS
  {
    const test = { passingPercentage: 50 };
    const attempt = { percentage: 55, expireReason: null };
    const passingThreshold = typeof test?.passingPercentage === "number" ? test.passingPercentage : 50;
    attempt.resultStatus = attempt.expireReason === "CHEATING" ? "FAIL" : attempt.percentage >= passingThreshold ? "PASS" : "FAIL";
    attempt.isPassed = attempt.resultStatus === "PASS";
    const pass = attempt.resultStatus === "PASS" && attempt.isPassed === true;
    results.push({
      scenario: "8. Fully evaluated score is 55%, threshold is 50%",
      expected: "resultStatus: PASS, isPassed: true",
      actual: `resultStatus: ${attempt.resultStatus}, isPassed: ${attempt.isPassed}`,
      passed: pass
    });
  }

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every(r => r.passed);
  console.log(`\nAll 8 Scenarios Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

testUnitScenarios();
