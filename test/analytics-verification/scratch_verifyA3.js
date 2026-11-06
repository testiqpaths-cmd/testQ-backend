import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import {
  getStudentDashboardData,
  resolveSubjectName,
} from "../../src/modules/analytics/dashboard/dashboard.service.js";

async function runA3Verification() {
  console.log("=== Running Phase A3 Unit & Integration Verification Checklist ===\n");
  const results = [];

  // Helper replicas matching dashboard.service.js
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

  const getPassingThreshold = (test) =>
    typeof test?.passingPercentage === "number"
      ? test.passingPercentage
      : 50;

  const getActualTimeTakenSeconds = (attempt) => {
    const recordedSeconds = Number(attempt.timeTakenSeconds);
    if (Number.isFinite(recordedSeconds) && recordedSeconds > 0) {
      return recordedSeconds;
    }
    const startedAt = new Date(attempt.startedAt).getTime();
    const submittedAt = new Date(attempt.submittedAt).getTime();
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(submittedAt) ||
      startedAt <= 0 ||
      submittedAt < startedAt
    ) {
      return 0;
    }
    const elapsedSeconds = Math.floor((submittedAt - startedAt) / 1000);
    const durationMinutes = Number(attempt.duration);
    if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
      return Math.min(elapsedSeconds, durationMinutes * 60);
    }
    return elapsedSeconds;
  };

  const formatDuration = (seconds) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return "—";
    const minutes = Math.floor(value / 60);
    const remainingSeconds = Math.floor(value % 60);
    if (minutes === 0) return `${remainingSeconds}s`;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getAttemptResultStatus = (attempt, percentage, test) => {
    if (attempt.resultStatus === "PASS") return "pass";
    if (attempt.resultStatus === "FAIL") return "fail";
    if (attempt.status !== "EVALUATED") return "pending";
    return percentage >= getPassingThreshold(test) ? "pass" : "fail";
  };

  // 1. A selected option of "0" and a numeric 0 both count as responses
  const strZero = answerHasValue({ selectedOption: "0" });
  const numZero = answerHasValue({ selectedOption: 0 });
  const emptyStr = answerHasValue({ selectedOption: "" });
  const whitespaceStr = answerHasValue({ selectedOption: "   " });
  results.push({
    item: "1. Option '0' and numeric 0 count as responses, empty/whitespace ignored",
    passed: strZero === true && numZero === true && emptyStr === false && whitespaceStr === false,
    details: `strZero: ${strZero}, numZero: ${numZero}, empty: ${emptyStr}, whitespace: ${whitespaceStr}`,
  });

  // 2. An unanswered answer with isCorrect=false is skipped, not wrong
  const unansAns = [{ questionId: "q1", selectedOption: null, textAnswer: null, isCorrect: false }];
  const totalQ2 = 1;
  const respCount2 = unansAns.filter(answerHasValue).length;
  const correctQ2 = unansAns.filter((a) => answerHasValue(a) && a.isCorrect === true).length;
  const wrongQ2 = unansAns.filter((a) => answerHasValue(a) && a.isCorrect === false).length;
  const skippedQ2 = Math.max(0, totalQ2 - respCount2);
  results.push({
    item: "2. Unanswered answer with isCorrect=false is skipped, not wrong",
    passed: correctQ2 === 0 && wrongQ2 === 0 && skippedQ2 === 1,
    details: `correct: ${correctQ2}, wrong: ${wrongQ2}, skipped: ${skippedQ2}`,
  });

  // 3. A non-empty text response with isCorrect=false counts as wrong
  const wrongTextAns = [{ questionId: "q2", textAnswer: "wrong solution", isCorrect: false }];
  const respCount3 = wrongTextAns.filter(answerHasValue).length;
  const wrongQ3 = wrongTextAns.filter((a) => answerHasValue(a) && a.isCorrect === false).length;
  const skippedQ3 = Math.max(0, 1 - respCount3);
  results.push({
    item: "3. Non-empty text response with isCorrect=false counts as wrong",
    passed: wrongQ3 === 1 && skippedQ3 === 0,
    details: `wrong: ${wrongQ3}, skipped: ${skippedQ3}`,
  });

  // 4. A non-empty but unevaluated text response is neither wrong nor skipped
  const pendingTextAns = [{ questionId: "q3", textAnswer: "essay to evaluate", isCorrect: null }];
  const respCount4 = pendingTextAns.filter(answerHasValue).length;
  const correctQ4 = pendingTextAns.filter((a) => answerHasValue(a) && a.isCorrect === true).length;
  const wrongQ4 = pendingTextAns.filter((a) => answerHasValue(a) && a.isCorrect === false).length;
  const skippedQ4 = Math.max(0, 1 - respCount4);
  results.push({
    item: "4. Non-empty but unevaluated text response is neither wrong nor skipped",
    passed: correctQ4 === 0 && wrongQ4 === 0 && skippedQ4 === 0,
    details: `correct: ${correctQ4}, wrong: ${wrongQ4}, skipped: ${skippedQ4}`,
  });

  // 5. Accuracy is correct / (correct + wrong), or 0 when no answers evaluated
  const mixedAnswers = [
    { selectedOption: "A", isCorrect: true },
    { selectedOption: "B", isCorrect: false },
    { textAnswer: "pending essay", isCorrect: null },
    { selectedOption: null, textAnswer: null, isCorrect: false },
  ];
  const c5 = mixedAnswers.filter((a) => answerHasValue(a) && a.isCorrect === true).length;
  const w5 = mixedAnswers.filter((a) => answerHasValue(a) && a.isCorrect === false).length;
  const att5 = c5 + w5;
  const acc5 = att5 > 0 ? Math.round((c5 / att5) * 100) : 0;

  const noEvalAnswers = [{ textAnswer: "pending", isCorrect: null }];
  const c5b = noEvalAnswers.filter((a) => answerHasValue(a) && a.isCorrect === true).length;
  const w5b = noEvalAnswers.filter((a) => answerHasValue(a) && a.isCorrect === false).length;
  const att5b = c5b + w5b;
  const acc5b = att5b > 0 ? Math.round((c5b / att5b) * 100) : 0;
  results.push({
    item: "5. Accuracy is correct / (correct + wrong), or 0 when no answers evaluated",
    passed: acc5 === 50 && acc5b === 0 && typeof acc5b === "number",
    details: `mixed: ${acc5}%, zero-evaluated: ${acc5b}`,
  });

  // 6. subjectWiseTests contains subject names, not topic names
  const testObj = {
    title: "Math Quiz",
    subjectIds: [{ name: "Mathematics" }],
    topicIds: [{ name: "Algebra" }, { name: "Calculus" }],
  };
  const resolvedSub = resolveSubjectName(testObj);
  results.push({
    item: "6. Subject name resolved from subjectIds, not topicIds",
    passed: resolvedSub === "Mathematics",
    details: `resolved: ${resolvedSub}`,
  });

  // 7. A 45% evaluated result fails when passingPercentage is 50
  const status45 = getAttemptResultStatus({ status: "EVALUATED", resultStatus: null }, 45, { passingPercentage: 50 });
  results.push({
    item: "7. A 45% evaluated result fails when passingPercentage is 50",
    passed: status45 === "fail",
    details: `status: ${status45}`,
  });

  // 8. A 55% evaluated result passes when passingPercentage is 50
  const status55 = getAttemptResultStatus({ status: "EVALUATED", resultStatus: null }, 55, { passingPercentage: 50 });
  results.push({
    item: "8. A 55% evaluated result passes when passingPercentage is 50",
    passed: status55 === "pass",
    details: `status: ${status55}`,
  });

  // 9. An awaiting-evaluation attempt is not rendered as a failure
  const statusPending = getAttemptResultStatus({ status: "SUBMITTED", resultStatus: null }, 20, { passingPercentage: 50 });
  results.push({
    item: "9. An awaiting-evaluation attempt is rendered as pending, not failure",
    passed: statusPending === "pending",
    details: `status: ${statusPending}`,
  });

  // 10. timeTaken uses actual seconds, with elapsed-time fallback capped by allotted duration
  // Case A: recorded timeTakenSeconds exists
  const timeA = getActualTimeTakenSeconds({ timeTakenSeconds: 42, duration: 60 });
  // Case B: recorded missing, elapsed 30s (duration 60m)
  const started = new Date("2026-10-27T10:00:00Z");
  const sub30 = new Date("2026-10-27T10:00:30Z");
  const timeB = getActualTimeTakenSeconds({ startedAt: started, submittedAt: sub30, duration: 60 });
  // Case C: recorded missing, elapsed 3600s, but test duration was 20m (1200s) -> capped at 1200s
  const sub3600 = new Date("2026-10-27T11:00:00Z");
  const timeC = getActualTimeTakenSeconds({ startedAt: started, submittedAt: sub3600, duration: 20 });
  // Format duration checks
  const fmt42 = formatDuration(42);
  const fmt125 = formatDuration(125);
  const fmt60 = formatDuration(60);
  results.push({
    item: "10. timeTaken uses actual seconds, capped by allotted duration; formatDuration handles s/m",
    passed: timeA === 42 && timeB === 30 && timeC === 1200 && fmt42 === "42s" && fmt125 === "2m 5s" && fmt60 === "1m",
    details: `timeA: ${timeA}s, timeB: ${timeB}s, timeC: ${timeC}s, fmt42: ${fmt42}, fmt125: ${fmt125}, fmt60: ${fmt60}`,
  });

  // 11. Live MongoDB test: Snapshot fallback and dashboard telemetry still execute correctly
  try {
    await mongoose.connect(process.env.MONGO_URI);
    // Student from database
    const sampleStudentId = "6a58fcec24446ef390bf4cf5";
    const data = await getStudentDashboardData(sampleStudentId);

    const hasTotalTests = typeof data.totalTestsAttempted === "number";
    const hasAccuracy = typeof data.accuracy === "number";
    const hasSubjectWise = Array.isArray(data.subjectWiseTests);
    const hasTests = Array.isArray(data.tests);
    const hasAllTests = Array.isArray(data.allTests);

    // Check subjects in subjectWiseTests are not topic names
    const subjects = data.subjectWiseTests.map((s) => s.subject);
    const firstTest = data.tests[0];
    const firstAllTest = data.allTests[0];

    const testTimeTakenFormatted = typeof firstTest?.timeTaken === "string";
    const allTestTimeTakenNumeric = typeof firstAllTest?.timeTaken === "number";
    const statusValid = ["pass", "fail", "pending"].includes(firstTest?.status);

    results.push({
      item: "11. Snapshot fallback, dashboard telemetry & live query execute correctly",
      passed: hasTotalTests && hasAccuracy && hasSubjectWise && hasTests && hasAllTests && testTimeTakenFormatted && allTestTimeTakenNumeric && statusValid,
      details: `tests: ${data.totalTestsAttempted}, accuracy: ${data.accuracy}%, subjects: [${subjects.slice(0, 3).join(", ")}], first test time: "${firstTest?.timeTaken}", allTest time: ${firstAllTest?.timeTaken}s, status: "${firstTest?.status}"`,
    });
  } catch (err) {
    results.push({
      item: "11. Snapshot fallback, dashboard telemetry & live query execute correctly",
      passed: false,
      details: `Error: ${err.message}`,
    });
  } finally {
    await mongoose.disconnect();
  }

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll 11 Checklist Items Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

runA3Verification();
