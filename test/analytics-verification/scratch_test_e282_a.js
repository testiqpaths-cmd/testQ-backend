import { getIsoWeekDetails, getWeekNumber } from "../../src/modules/analytics/utils/date.js";

console.log("=== Running Step E2.8.2-A Verification Tests ===");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

// Test 1: December 30, 2024 -> 2025-W01
const d1 = new Date("2024-12-30T12:00:00Z");
const res1 = getIsoWeekDetails(d1);
assert(res1.weekKey === "2025-W01", `Dec 30, 2024 -> 2025-W01 (got ${res1.weekKey})`);
assert(res1.weekNum === 1, `Dec 30, 2024 weekNum === 1 (got ${res1.weekNum})`);
assert(res1.isoYear === 2025, `Dec 30, 2024 isoYear === 2025 (got ${res1.isoYear})`);
assert(res1.label === "Week 1", `Dec 30, 2024 label === Week 1 (got ${res1.label})`);

// Test 2: January 1, 2025 -> 2025-W01
const d2 = new Date("2025-01-01T12:00:00Z");
const res2 = getIsoWeekDetails(d2);
assert(res2.weekKey === "2025-W01", `Jan 1, 2025 -> 2025-W01 (got ${res2.weekKey})`);
assert(res2.weekNum === 1, `Jan 1, 2025 weekNum === 1 (got ${res2.weekNum})`);
assert(res2.isoYear === 2025, `Jan 1, 2025 isoYear === 2025 (got ${res2.isoYear})`);

// Test 3: December 31, 2025 -> 2026-W01
const d3 = new Date("2025-12-31T12:00:00Z");
const res3 = getIsoWeekDetails(d3);
assert(res3.weekKey === "2026-W01", `Dec 31, 2025 -> 2026-W01 (got ${res3.weekKey})`);
assert(res3.weekNum === 1, `Dec 31, 2025 weekNum === 1 (got ${res3.weekNum})`);
assert(res3.isoYear === 2026, `Dec 31, 2025 isoYear === 2026 (got ${res3.isoYear})`);

// Test 4: Normal date in the middle of a year
const d4 = new Date("2025-07-16T12:00:00Z"); // July 16, 2025 is Wednesday of Week 29
const res4 = getIsoWeekDetails(d4);
assert(res4.weekKey === "2025-W29", `Jul 16, 2025 -> 2025-W29 (got ${res4.weekKey})`);
assert(res4.weekNum === 29, `Jul 16, 2025 weekNum === 29 (got ${res4.weekNum})`);
assert(res4.isoYear === 2025, `Jul 16, 2025 isoYear === 2025 (got ${res4.isoYear})`);

// Test 5: Chronological sorting across year boundaries
const weekKeys = [
  getIsoWeekDetails(new Date("2025-01-05T12:00:00Z")).weekKey, // 2025-W01
  getIsoWeekDetails(new Date("2024-12-25T12:00:00Z")).weekKey, // 2024-W52
  getIsoWeekDetails(new Date("2024-12-30T12:00:00Z")).weekKey, // 2025-W01
  getIsoWeekDetails(new Date("2025-01-15T12:00:00Z")).weekKey, // 2025-W03
  getIsoWeekDetails(new Date("2025-12-31T12:00:00Z")).weekKey, // 2026-W01
];
const sorted = [...new Set(weekKeys)].sort();
const expectedOrder = ["2024-W52", "2025-W01", "2025-W03", "2026-W01"];
assert(
  JSON.stringify(sorted) === JSON.stringify(expectedOrder),
  `Chronological sort across year boundaries: ${JSON.stringify(sorted)}`
);

// Test 6: getWeekNumber helper consistency
assert(getWeekNumber(d1) === 1, `getWeekNumber(Dec 30 2024) === 1`);
assert(getWeekNumber(d4) === 29, `getWeekNumber(Jul 16 2025) === 29`);

console.log(`\nResult: ${passed}/${total} tests passed.`);
if (passed === total) {
  console.log("🎉 Gate E2.8.2-A PASSED!");
  process.exit(0);
} else {
  console.error("💥 Gate E2.8.2-A FAILED!");
  process.exit(1);
}
