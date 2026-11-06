# Dashboard Analytics Verification & Audit Suite

This directory contains verification test suites, profiling benchmarks, and historical reconciliation reports used to validate the accuracy, tenant isolation, and performance of the TestQ Analytics Dashboards (Admin, Organization, and Student).

## Quick Start: Running Key Verification Suites

All scripts can be executed directly using Node.js from the `testQ-backend/` root:

```bash
# Final E2.10 Acceptance Audit (Metrics, Isolation, Boundaries, 20-run Benchmark)
node test/analytics-verification/scratch_auditE210.js

# Phase E2.9.3 Verification Suite (All-history series, Student payload, Org isolation)
node test/analytics-verification/scratch_verifyE293.js

# Phase E2.8.3 Aggregation Integrity (Date boundaries, ISO week-years, coverage)
node test/analytics-verification/scratch_verifyE283.js

# Phase E2.7 Cross-Dashboard Consistency (Shared attempt status, navigation)
node test/analytics-verification/scratch_verifyE27_integration.js

# Phase E2.6 Rounding & Precision (Unrounded pass/fail, pooled accuracy)
node test/analytics-verification/scratch_verifyE26.js

# Phase A3 Integration Suite
node test/analytics-verification/scratch_verifyA3.js
```

---

## Directory Contents

### Core Verification Suites
- `scratch_auditE210.js`: Phase E2.10 Final Analytics Acceptance Audit (all 7 gates).
- `scratch_verifyE293.js`: Phase E2.9.3 Final Performance and Semantic Verification.
- `scratch_verifyE283.js` & `scratch_verifyE282.js`: Phase E2.8 Aggregation Integrity and Date Boundary verification.
- `scratch_verifyE27.js` & `scratch_verifyE27_integration.js`: Phase E2.7 Cross-Dashboard Consistency and integration tests.
- `scratch_verifyE26.js`: Phase E2.6 Rounding & Precision verification (unrounded threshold checks).
- `scratch_verifyA1A2.js` & `scratch_verifyA3.js`: Phase A1-A3 metrics, duration formatting, and question accounting.
- `scratch_verifyB1.js` - `scratch_verifyB4.js`: Attempt analytics snapshot and reconciliation verification.
- `scratch_verifyC2Backend.js`: Subject distribution and category telemetry checks.

### Performance Profiling & Query Explain Scripts
- `scratch_profileE29.js`: End-to-end multi-run profiling and execution-plan breakdown.
- `scratch_profileDashboardQueries.js`: Isolated stream query latency measurement.
- `scratch_explainOrgQuery.js`: Organization student/test scoping execution plan explain.
- `scratch_explainStream3.js`: Stream 3 historical attempt query plan explain.
- `scratch_explainSortVariations.js`: Sort index evaluation.
- `scratch_measureUncapped.js`: Uncapped historical query measurement.

### Reconciliation Scripts & Reports
- `scratch_parityCheck.js`: Parity check between raw attempts and snapshot data.
- `scratch_testReconciliationFailures.js`: Reconciliation boundary testing.
- `scratch_checkAllInflation.js` & `scratch_inspectDiscrepancy.js`: Score inflation and discrepancy investigation.
- `attempt-analytics-reconciliation-report.json`: Reconciliation report artifact.
- `reconciliation-dry-run-report.json`, `reconciliation-execution-report.json`, `reconciliation-verification-report.json`: Historical execution artifacts.
