// The extracted gate must behave exactly like the inline code it replaced.
import test from "node:test";
import assert from "node:assert/strict";
import { ensureAssignmentAccepted } from "../../src/modules/test-attempts/services/assignmentGate.service.js";

// Reference: the original inline logic from startTestAttemptController.
const original = async ({ t, testId, studentId, TestAssignment, loadSeries }) => {
  let isCompanyTest = Boolean(t.companyId);
  if (!isCompanyTest && t.testSeriesId) {
    const series = await loadSeries(t.testSeriesId);
    if (series && (series.category === "COMPANY" || series.companyId)) isCompanyTest = true;
  }
  let assignment = await TestAssignment.findOne({ testId, studentId });
  if (!assignment && isCompanyTest) {
    assignment = await TestAssignment.create({ testId, studentId, status: "ACCEPTED", acceptedAt: new Date() });
  }
  return !(!assignment || !assignment.acceptedAt || assignment.status === "DECLINED");
};

const fakeModel = (existing) => {
  const created = [];
  return {
    created,
    findOne: async () => existing,
    create: async (doc) => { created.push(doc); return { ...doc }; },
  };
};

test("gate returns the same decision and creates the same records as the original logic", async () => {
  const existingCases = [
    null,
    { status: "ACCEPTED", acceptedAt: new Date() },
    { status: "PENDING", acceptedAt: null },
    { status: "DECLINED", acceptedAt: new Date() },
    { status: "STARTED", acceptedAt: new Date() },
    { status: "HIDDEN", acceptedAt: null },
  ];
  const tests = [
    { companyId: "C1", testSeriesId: null },
    { companyId: null, testSeriesId: null },
    { companyId: null, testSeriesId: "S1" },
  ];
  const seriesCases = [null, { category: "COMPANY" }, { category: "GENERAL" }, { category: "GENERAL", companyId: "C1" }];
  let compared = 0;
  for (const existing of existingCases) for (const t of tests) for (const series of seriesCases) {
    const loadSeries = async () => series;
    const a = fakeModel(existing), b = fakeModel(existing);
    const expected = await original({ t, testId: "T1", studentId: "U1", TestAssignment: a, loadSeries });
    const actual = await ensureAssignmentAccepted({ test: t, testId: "T1", studentId: "U1", deps: { TestAssignment: b, loadSeries } });
    assert.equal(actual, expected, JSON.stringify({ existing, t, series }));
    assert.equal(b.created.length, a.created.length, "same number of assignment records created");
    if (a.created.length) {
      assert.equal(b.created[0].status, "ACCEPTED");
      assert.equal(b.created[0].testId, "T1");
      assert.equal(b.created[0].studentId, "U1");
    }
    compared++;
  }
  assert.equal(compared, existingCases.length * tests.length * seriesCases.length);
});

test("company-wise test needs no acceptance: an accepted record is created on first start", async () => {
  const model = fakeModel(null);
  const ok = await ensureAssignmentAccepted({ test: { companyId: "C1" }, testId: "T", studentId: "U", deps: { TestAssignment: model } });
  assert.equal(ok, true);
  assert.equal(model.created.length, 1);
});

test("ordinary test without an accepted assignment is refused and nothing is created", async () => {
  const model = fakeModel(null);
  const ok = await ensureAssignmentAccepted({ test: { companyId: null, testSeriesId: null }, testId: "T", studentId: "U", deps: { TestAssignment: model } });
  assert.equal(ok, false);
  assert.equal(model.created.length, 0);
});
