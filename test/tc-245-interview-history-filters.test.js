import test from "node:test";
import assert from "node:assert/strict";
import { filterInterviewHistory } from "../../../testQ-frontend/testQ-frontend/src/features/ai-interview/utils/interview.utils.js";

const SAMPLE_HISTORY = [
  {
    id: "int-1",
    role: "Frontend Developer",
    difficulty: "easy",
    status: "completed",
    score: 85,
    readinessScore: 82,
    date: "2026-10-20T10:00:00Z",
  },
  {
    id: "int-2",
    role: "Frontend Developer",
    difficulty: "medium",
    status: "in_progress",
    score: null,
    readinessScore: null,
    date: "2026-10-21T11:00:00Z",
  },
  {
    id: "int-3",
    role: "Frontend Developer",
    difficulty: "hard",
    status: "completed",
    score: 92,
    readinessScore: 90,
    date: "2026-10-22T09:00:00Z",
  },
  {
    id: "int-4",
    role: "Backend Developer",
    difficulty: "medium",
    status: "completed",
    score: 78,
    readinessScore: 75,
    date: "2026-10-18T14:00:00Z",
  },
  {
    id: "int-5",
    role: "Backend Developer",
    difficulty: "hard",
    status: "missed",
    score: 0,
    readinessScore: 0,
    date: "2026-10-19T16:00:00Z",
  },
  {
    id: "int-6",
    role: "Full Stack Developer",
    difficulty: "adaptive",
    status: "evaluating",
    score: 80,
    readinessScore: 79,
    date: "2026-10-22T12:00:00Z",
  },
];

test("TC-245: Interview History Filters Suite", async (t) => {
  await t.test("Scenario 1: No filters selected -> all available interview history is displayed", () => {
    const resAll = filterInterviewHistory(SAMPLE_HISTORY, {});
    assert.equal(resAll.length, SAMPLE_HISTORY.length, "Must return all interviews when no filter is provided");

    const resExplicitAll = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "ALL",
      difficulty: "ALL",
      status: "ALL",
    });
    assert.equal(resExplicitAll.length, SAMPLE_HISTORY.length, "Must return all interviews when ALL is selected");
  });

  await t.test("Scenario 2: Role = 'Frontend Developer' -> only matching interviews are displayed", () => {
    const res = filterInterviewHistory(SAMPLE_HISTORY, { role: "Frontend Developer" });
    assert.equal(res.length, 3, "Expected 3 Frontend Developer interviews");
    assert.ok(res.every((item) => item.role === "Frontend Developer"));
  });

  await t.test("Scenario 3: Status = 'Completed' -> only completed interviews are displayed", () => {
    // Test case insensitive match and capitalized input
    const res = filterInterviewHistory(SAMPLE_HISTORY, { status: "Completed" });
    assert.equal(res.length, 3, "Expected 3 completed interviews (int-1, int-3, int-4)");
    assert.ok(res.every((item) => item.status === "completed"));

    // Also test raw backend status string "COMPLETED"
    const resUpper = filterInterviewHistory(SAMPLE_HISTORY, { status: "COMPLETED" });
    assert.equal(resUpper.length, 3);
  });

  await t.test("Scenario 4: Role = 'Frontend Developer', Status = 'Completed' -> only interviews matching both criteria", () => {
    const res = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Frontend Developer",
      status: "Completed",
    });
    assert.equal(res.length, 2, "Expected 2 Frontend Developer completed interviews (int-1, int-3)");
    assert.deepEqual(
      res.map((i) => i.id).sort(),
      ["int-1", "int-3"].sort()
    );
  });

  await t.test("Scenario 5: Difficulty selected with role and status -> all criteria applied together", () => {
    // Frontend Developer + Completed + Hard -> only int-3
    const resHard = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Frontend Developer",
      difficulty: "Hard",
      status: "Completed",
    });
    assert.equal(resHard.length, 1);
    assert.equal(resHard[0].id, "int-3");

    // Frontend Developer + Completed + Easy -> only int-1
    const resEasy = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Frontend Developer",
      difficulty: "easy",
      status: "completed",
    });
    assert.equal(resEasy.length, 1);
    assert.equal(resEasy[0].id, "int-1");

    // Backend Developer + Medium + Completed -> only int-4
    const resBackend = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Backend Developer",
      difficulty: "medium",
      status: "Completed",
    });
    assert.equal(resBackend.length, 1);
    assert.equal(resBackend[0].id, "int-4");
  });

  await t.test("Scenario 6: Filters cleared -> original history is restored", () => {
    // Start with strict filter
    const filtered = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Backend Developer",
      difficulty: "Hard",
      status: "Missed",
    });
    assert.equal(filtered.length, 1);

    // Reset filters
    const restored = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "ALL",
      difficulty: "ALL",
      status: "ALL",
    });
    assert.equal(restored.length, SAMPLE_HISTORY.length);
  });

  await t.test("Scenario 7: No matching interviews -> returns empty array for clear empty-state display", () => {
    const resNone = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "DevOps Engineer",
    });
    assert.equal(resNone.length, 0, "No DevOps Engineer interviews exist in sample");

    const resMismatchedCombo = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Frontend Developer",
      difficulty: "hard",
      status: "in_progress",
    });
    assert.equal(resMismatchedCombo.length, 0, "No in-progress hard frontend interview exists");
  });

  await t.test("Scenario 8: Search filtering functions smoothly alongside dropdown filters", () => {
    const resSearchOnly = filterInterviewHistory(SAMPLE_HISTORY, {
      search: "backend",
    });
    assert.equal(resSearchOnly.length, 2, "Expected 2 backend developer interviews");

    const resSearchPlusRole = filterInterviewHistory(SAMPLE_HISTORY, {
      role: "Frontend Developer",
      search: "easy",
    });
    assert.equal(resSearchPlusRole.length, 1);
    assert.equal(resSearchPlusRole[0].id, "int-1");
  });

  await t.test("Graceful edge case handling: empty history, undefined fields, null input", () => {
    assert.deepEqual(filterInterviewHistory([], { role: "Frontend Developer" }), []);
    assert.deepEqual(filterInterviewHistory(null, { role: "Frontend Developer" }), []);
    assert.deepEqual(filterInterviewHistory(undefined, {}), []);

    // Malformed rows
    const malformed = [{ id: "bad-1" }, null, { role: undefined, status: null }];
    const res = filterInterviewHistory(malformed, { role: "ALL" });
    assert.equal(res.length, 2);
  });
});
