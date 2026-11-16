// Equivalence tests: each helper must give the same answer as the inline
// expression it replaced, for every combination of inputs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasCompanyFields,
  isCompanySeries,
  isCompanyTrackTest,
  NOT_COMPANY_TEST_FILTER,
  NOT_COMPANY_SERIES_FILTER,
  isInCompanySeries,
} from "../../src/modules/test-management/utils/testContext.js";

const ID = "6a99401" + "0be3d8d515f20e694";
const values = [undefined, null, "", ID];
const categories = [undefined, "GENERAL", "COMPANY", "STANDARD"];

test("hasCompanyFields matches (test.companyId || test.companyStageKey)", () => {
  for (const companyId of values) for (const companyStageKey of values) {
    const t = { companyId, companyStageKey };
    assert.equal(hasCompanyFields(t), Boolean(t.companyId || t.companyStageKey));
  }
  assert.equal(hasCompanyFields(null), false);
  assert.equal(hasCompanyFields(undefined), false);
});

test("isCompanySeries matches (series && series.category === 'COMPANY')", () => {
  for (const category of categories) {
    const s = { category };
    assert.equal(isCompanySeries(s), Boolean(s && s.category === "COMPANY"));
  }
  assert.equal(isCompanySeries(null), false);
});

test("isCompanyTrackTest matches the start-attempt acceptance rule", () => {
  // Original inline logic (testAttempt.controller.js):
  //   let isCompanyTest = Boolean(test.companyId);
  //   if (!isCompanyTest && test.testSeriesId) {
  //     series = await findById(...)
  //     if (series && (series.category === "COMPANY" || series.companyId)) isCompanyTest = true;
  //   }
  const original = (t, series) => {
    let r = Boolean(t.companyId);
    if (!r && t.testSeriesId) { if (series && (series.category === "COMPANY" || series.companyId)) r = true; }
    return r;
  };
  for (const companyId of values) for (const testSeriesId of [null, "S1"]) {
    for (const category of categories) for (const seriesCompany of values) {
      const t = { companyId, testSeriesId };
      const series = testSeriesId ? { category, companyId: seriesCompany } : null;
      assert.equal(
        isCompanyTrackTest(t, series), original(t, series),
        JSON.stringify({ t, series })
      );
    }
  }
});

test("NOT_COMPANY_TEST_FILTER keeps only tests without company fields", () => {
  const matches = (doc, f) => Object.entries(f).every(([k, v]) => v === null ? (doc[k] === null || doc[k] === undefined) : false);
  assert.equal(matches({}, NOT_COMPANY_TEST_FILTER), true);
  assert.equal(matches({ companyId: null, companyStageKey: null }, NOT_COMPANY_TEST_FILTER), true);
  assert.equal(matches({ companyId: ID }, NOT_COMPANY_TEST_FILTER), false);
  assert.equal(matches({ companyStageKey: "ROUND_1" }, NOT_COMPANY_TEST_FILTER), false);
  assert.deepEqual(NOT_COMPANY_SERIES_FILTER, { category: { $ne: "COMPANY" } });
});

test("isInCompanySeries matches the in-memory series check used by the assigned list", () => {
  for (const category of categories) {
    const t = { testSeriesId: { category } };
    assert.equal(isInCompanySeries(t), t.testSeriesId?.category === "COMPANY");
  }
  assert.equal(isInCompanySeries({ testSeriesId: null }), false);
  assert.equal(isInCompanySeries({}), false);
});
