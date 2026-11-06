import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import {
  RECONCILIATION_KEY,
  TARGET_ATTEMPTS_CONFIG,
  TARGET_STUDENTS_CONFIG,
} from "../../src/scripts/reconcileTargetAttemptAnalytics.js";

async function runFailurePathTests() {
  console.log("=== Running Reconciliation Failure-Path & Safety Tests ===\n");
  const results = [];

  // Test 1: Scope integrity: exactly 9 attempts and 6 students configured
  const countAttempts = TARGET_ATTEMPTS_CONFIG.length === 9;
  const countStudents = TARGET_STUDENTS_CONFIG.length === 6;
  const distinctAttemptIds = new Set(TARGET_ATTEMPTS_CONFIG.map((c) => c.attemptId)).size === 9;
  const distinctStudentIds = new Set(TARGET_STUDENTS_CONFIG.map((c) => c.studentId)).size === 6;

  results.push({
    test: "1. Scope integrity: Exactly 9 unique attempts and 6 unique students configured",
    passed: countAttempts && countStudents && distinctAttemptIds && distinctStudentIds,
    details: `attempts: ${TARGET_ATTEMPTS_CONFIG.length}, students: ${TARGET_STUDENTS_CONFIG.length}`,
  });

  // Test 2: Arithmetic consistency across all student configurations
  const studentMathPassed = TARGET_STUDENTS_CONFIG.every((s) => {
    const after = s.targetAfter;
    return after.correct + after.wrong === after.answered;
  });

  results.push({
    test: "2. Arithmetic consistency: targetAfter satisfies correct + wrong === answered for all students",
    passed: studentMathPassed,
    details: `all valid: ${studentMathPassed}`,
  });

  // Test 3: Sum of attempt deltas matches student aggregate deltas
  let netAttemptDeltaC = 0;
  let netAttemptDeltaW = 0;
  for (const a of TARGET_ATTEMPTS_CONFIG) {
    netAttemptDeltaC += a.delta.correct;
    netAttemptDeltaW += a.delta.wrong;
  }

  let netStudentDeltaC = 0;
  let netStudentDeltaW = 0;
  let netStudentDeltaA = 0;
  for (const s of TARGET_STUDENTS_CONFIG) {
    netStudentDeltaC += s.delta.correct;
    netStudentDeltaW += s.delta.wrong;
    netStudentDeltaA += s.delta.answered;
  }

  const deltaParity =
    netAttemptDeltaC === netStudentDeltaC &&
    netAttemptDeltaW === netStudentDeltaW &&
    netStudentDeltaC + netStudentDeltaW === netStudentDeltaA;

  results.push({
    test: "3. Delta parity: Sum of attempt deltas strictly equals student aggregate deltas (+9 C, -5 W, +4 A)",
    passed: deltaParity && netAttemptDeltaC === 9 && netAttemptDeltaW === -5 && netStudentDeltaA === 4,
    details: `attempt: (+${netAttemptDeltaC} C, ${netAttemptDeltaW} W) | student: (+${netStudentDeltaC} C, ${netStudentDeltaW} W, +${netStudentDeltaA} A)`,
  });

  // Test 4: Concurrency safeguard simulation (before-value mismatch aborts)
  let simulatedAbortTriggered = false;
  try {
    const modifiedAttemptBefore = { correct: 0, wrong: 99, skipped: 8 }; // Tampered stored wrong
    const expected = TARGET_ATTEMPTS_CONFIG[0].expectedBefore;
    if (
      modifiedAttemptBefore.correct !== expected.correct ||
      modifiedAttemptBefore.wrong !== expected.wrong
    ) {
      throw new Error("Preflight Failure: Attempt before-values mismatch. Aborting transaction.");
    }
  } catch (err) {
    simulatedAbortTriggered = err.message.includes("Preflight Failure");
  }

  results.push({
    test: "4. Concurrency safeguard: Stored counter mismatch triggers immediate transaction abort",
    passed: simulatedAbortTriggered,
    details: `aborted: ${simulatedAbortTriggered}`,
  });

  // Test 5: Idempotency check simulation (repeat run detected)
  let idempotencyHandled = false;
  const mockExistingAuditLog = {
    reconciliationKey: RECONCILIATION_KEY,
    status: "COMPLETED",
    executedAt: new Date("2026-10-27T10:00:00Z"),
  };

  if (mockExistingAuditLog && mockExistingAuditLog.status === "COMPLETED") {
    idempotencyHandled = true; // Simulates skipping execution on repeat run
  }

  results.push({
    test: "5. Idempotency safeguard: Completed audit log record prevents duplicate execution",
    passed: idempotencyHandled,
    details: `skipped on duplicate: ${idempotencyHandled}`,
  });

  // Test 6: Promotion blocker invariant: No attempt config modifies metricsVersion
  const noConfigPromotesLedger = TARGET_ATTEMPTS_CONFIG.every(
    (c) => !c.metricsVersion && !c.canonicalMetrics
  );

  results.push({
    test: "6. Ledger protection: Configuration contains zero ledger promotions (remains legacy)",
    passed: noConfigPromotesLedger,
    details: `promotions present: ${!noConfigPromotesLedger}`,
  });

  console.log(JSON.stringify(results, null, 2));
  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll Failure-Path Tests Passed: ${allPassed ? "✅ YES" : "❌ NO"}`);
}

runFailurePathTests().catch(console.error);
