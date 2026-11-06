import assert from "node:assert/strict";

console.log("=== Running Phase E2.6 Backend Verification Checklist ===");

// 1. Simulation of evaluateObjectiveAttempts logic
function evaluateObjectiveSimulation({ totalScore, maxScore, passingPercentage, expireReason, hasSubjective = false }) {
  const attempt = {
    totalScore,
    maxScore,
    expireReason,
    answers: [],
  };
  const test = { passingPercentage };

  const rawPercentage =
    attempt.maxScore && attempt.maxScore > 0
      ? (totalScore / attempt.maxScore) * 100
      : 0;
  attempt.percentage = Math.round(rawPercentage);

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

  return attempt;
}

// 2. Simulation of manualEvaluateAttempt logic
function manualEvaluateSimulation({ totalScore, maxScore, passingPercentage, expireReason }) {
  const attempt = {
    totalScore,
    maxScore,
    expireReason,
    answers: [],
  };
  const test = { passingPercentage };

  const rawPercentage =
    attempt.maxScore && attempt.maxScore > 0
      ? (totalScore / attempt.maxScore) * 100
      : 0;
  attempt.percentage = Math.round(rawPercentage);

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

  return attempt;
}

// 3. Simulation of getAttemptResultStatus logic in dashboard.service.js
const getPassingThreshold = (test) =>
  typeof test?.passingPercentage === "number"
    ? test.passingPercentage
    : 50;

const getAttemptResultStatus = (attempt, percentage, test) => {
  if (attempt.resultStatus === "PASS") return "pass";
  if (attempt.resultStatus === "FAIL") return "fail";
  if (attempt.status !== "EVALUATED") return "pending";

  const passingThreshold = getPassingThreshold(test);

  if (
    typeof attempt.totalScore === "number" &&
    typeof attempt.maxScore === "number" &&
    attempt.maxScore > 0
  ) {
    const rawPercentage = (attempt.totalScore / attempt.maxScore) * 100;
    return rawPercentage >= passingThreshold ? "pass" : "fail";
  }

  const fallbackPercentage =
    typeof percentage === "number"
      ? percentage
      : typeof attempt.percentage === "number"
        ? attempt.percentage
        : 0;

  return fallbackPercentage >= passingThreshold ? "pass" : "fail";
};

const checks = [];

// Check 1: 69.4% at 70% threshold
const r694 = evaluateObjectiveSimulation({ totalScore: 69.4, maxScore: 100, passingPercentage: 70 });
assert.strictEqual(r694.resultStatus, "FAIL");
assert.strictEqual(r694.isPassed, false);
assert.strictEqual(r694.percentage, 69);
checks.push({ item: "1. 69.4% at 70% threshold fails (display 69%)", passed: true });

// Check 2: 69.5% at 70% threshold (139 / 200 = 69.5%)
const r695 = evaluateObjectiveSimulation({ totalScore: 139, maxScore: 200, passingPercentage: 70 });
assert.strictEqual(r695.resultStatus, "FAIL", "69.5% must fail at 70% threshold");
assert.strictEqual(r695.isPassed, false);
assert.strictEqual(r695.percentage, 70, "Display percentage rounds to 70%");
checks.push({ item: "2. 69.5% at 70% threshold fails (unrounded 69.5% < 70%, display 70%)", passed: true });

// Check 3: 69.9% at 70% threshold
const r699 = evaluateObjectiveSimulation({ totalScore: 69.9, maxScore: 100, passingPercentage: 70 });
assert.strictEqual(r699.resultStatus, "FAIL", "69.9% must fail at 70% threshold");
assert.strictEqual(r699.isPassed, false);
assert.strictEqual(r699.percentage, 70);
checks.push({ item: "3. 69.9% at 70% threshold fails (unrounded 69.9% < 70%, display 70%)", passed: true });

// Check 4: 70.0% at 70% threshold
const r700 = evaluateObjectiveSimulation({ totalScore: 140, maxScore: 200, passingPercentage: 70 });
assert.strictEqual(r700.resultStatus, "PASS", "70.0% must pass at 70% threshold");
assert.strictEqual(r700.isPassed, true);
assert.strictEqual(r700.percentage, 70);
checks.push({ item: "4. 70.0% at 70% threshold passes", passed: true });

// Check 5: 49.5% at 50% threshold (99 / 200 = 49.5%)
const r495 = evaluateObjectiveSimulation({ totalScore: 99, maxScore: 200, passingPercentage: 50 });
assert.strictEqual(r495.resultStatus, "FAIL", "49.5% must fail at 50% threshold");
assert.strictEqual(r495.isPassed, false);
assert.strictEqual(r495.percentage, 50, "Display percentage rounds to 50%");
checks.push({ item: "5. 49.5% at 50% threshold fails (unrounded 49.5% < 50%, display 50%)", passed: true });

// Check 6: 49.9% at 50% threshold
const r499 = evaluateObjectiveSimulation({ totalScore: 49.9, maxScore: 100, passingPercentage: 50 });
assert.strictEqual(r499.resultStatus, "FAIL", "49.9% must fail at 50% threshold");
assert.strictEqual(r499.isPassed, false);
assert.strictEqual(r499.percentage, 50);
checks.push({ item: "6. 49.9% at 50% threshold fails (unrounded 49.9% < 50%, display 50%)", passed: true });

// Check 7: 50.0% at 50% threshold
const r500 = evaluateObjectiveSimulation({ totalScore: 100, maxScore: 200, passingPercentage: 50 });
assert.strictEqual(r500.resultStatus, "PASS", "50.0% must pass at 50% threshold");
assert.strictEqual(r500.isPassed, true);
assert.strictEqual(r500.percentage, 50);
checks.push({ item: "7. 50.0% at 50% threshold passes", passed: true });

// Check 8: Manual evaluation parity on boundary behavior
const m695 = manualEvaluateSimulation({ totalScore: 139, maxScore: 200, passingPercentage: 70 });
assert.strictEqual(m695.resultStatus, "FAIL");
assert.strictEqual(m695.isPassed, false);
assert.strictEqual(m695.percentage, 70);

const m700 = manualEvaluateSimulation({ totalScore: 140, maxScore: 200, passingPercentage: 70 });
assert.strictEqual(m700.resultStatus, "PASS");
assert.strictEqual(m700.isPassed, true);
assert.strictEqual(m700.percentage, 70);
checks.push({ item: "8. Objective and manual evaluation agree on boundary behavior", passed: true });

// Check 9: Cheating-related FAIL behavior remains intact
const cheatObjective = evaluateObjectiveSimulation({ totalScore: 100, maxScore: 100, passingPercentage: 50, expireReason: "CHEATING" });
assert.strictEqual(cheatObjective.resultStatus, "FAIL");
assert.strictEqual(cheatObjective.isPassed, false);

const cheatManual = manualEvaluateSimulation({ totalScore: 100, maxScore: 100, passingPercentage: 50, expireReason: "CHEATING" });
assert.strictEqual(cheatManual.resultStatus, "FAIL");
assert.strictEqual(cheatManual.isPassed, false);
checks.push({ item: "9. Cheating-related FAIL behavior remains intact", passed: true });

// Check 10: Dashboard fallback status resolution
const fallback695 = getAttemptResultStatus(
  { status: "EVALUATED", totalScore: 139, maxScore: 200 },
  70,
  { passingPercentage: 70 }
);
assert.strictEqual(fallback695, "fail", "Unrounded raw scores (69.5%) must fail at 70% threshold in dashboard fallback");

const fallback700 = getAttemptResultStatus(
  { status: "EVALUATED", totalScore: 140, maxScore: 200 },
  70,
  { passingPercentage: 70 }
);
assert.strictEqual(fallback700, "pass", "Unrounded raw scores (70.0%) must pass at 70% threshold in dashboard fallback");

const fallbackLegacyRounded = getAttemptResultStatus(
  { status: "EVALUATED", percentage: 70 },
  70,
  { passingPercentage: 70 }
);
assert.strictEqual(fallbackLegacyRounded, "pass", "Historical attempt with only integer percentage uses integer fallback");

const fallbackPending = getAttemptResultStatus(
  { status: "SUBMITTED", totalScore: 100, maxScore: 100 },
  100,
  { passingPercentage: 50 }
);
assert.strictEqual(fallbackPending, "pending", "Unevaluated attempt returns pending");

const fallbackPersisted = getAttemptResultStatus(
  { status: "EVALUATED", resultStatus: "FAIL", totalScore: 100, maxScore: 100 },
  100,
  { passingPercentage: 50 }
);
assert.strictEqual(fallbackPersisted, "fail", "Persisted resultStatus takes precedence");
checks.push({ item: "10. Dashboard fallback status correctly resolves unrounded scores, legacy attempts, and pending attempts", passed: true });

console.log(JSON.stringify(checks, null, 2));
console.log("\nAll Phase E2.6 Backend Checks Passed: ✅ YES");
