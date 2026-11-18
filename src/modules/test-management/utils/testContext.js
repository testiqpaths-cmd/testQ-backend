// One place for the question "does this test/series belong to the Company Wise feature?".
//
// Company-wise tests are a separate feature from assigned tests: they are
// predefined, always open for practice, have no schedule and need no acceptance.
// The rules below were previously written inline in several places, with
// slightly different conditions; each helper here reproduces exactly one of
// those conditions, so callers behave the same as before.

/** A test that carries company fields of its own (a company or a company stage). */
export const hasCompanyFields = (test) =>
  Boolean(test && (test.companyId || test.companyStageKey));

/** A series that is a company-wise placement track. */
export const isCompanySeries = (series) =>
  Boolean(series && series.category === "COMPANY");

/**
 * True when the test is part of the Company Wise feature: either it carries a
 * company id itself, or its series is a company track (or is tied to a company).
 * `series` is only needed when the test has no company id of its own.
 */
export const isCompanyTrackTest = (test, series = null) =>
  Boolean(test && test.companyId) ||
  Boolean(series && (series.category === "COMPANY" || series.companyId));

/**
 * Mongo filter fragment for Test queries that must NOT return company-wise tests
 * (for example the assigned-tests list). Matches tests with no company id and no
 * company stage.
 */
export const NOT_COMPANY_TEST_FILTER = Object.freeze({
  companyId: null,
  companyStageKey: null,
});

/** Mongo filter fragment for TestSeries queries that must NOT return company tracks. */
export const NOT_COMPANY_SERIES_FILTER = Object.freeze({
  category: { $ne: "COMPANY" },
});

/**
 * In-memory counterpart of NOT_COMPANY_TEST_FILTER for tests whose series has
 * been populated: a test inside a company track is excluded even when the test
 * document has no company fields.
 */
export const isInCompanySeries = (test) => isCompanySeries(test?.testSeriesId);
