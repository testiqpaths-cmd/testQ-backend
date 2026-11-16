import { isCompanyTrackTest } from "../../test-management/utils/testContext.js";

/**
 * Start-attempt gate for a student: has this test's assignment been accepted?
 *
 * Acceptance only needs to happen once per test — `acceptedAt` is the persistent
 * record of that, unlike `status`, which also tracks per-attempt lifecycle
 * (STARTED/SUBMITTED) and gets overwritten after every attempt, so it can't be
 * used as the gate here.
 *
 * Company-wise tests are predefined practice tests with no assignment step, so
 * an ACCEPTED assignment is created for them on first use. A self-authored test
 * already has its ACCEPTED record (created when it appeared on the assigned
 * list), so it needs no special-casing here.
 *
 * Returns true when the student may start the test, false otherwise.
 * `deps` lets tests inject fakes; production callers omit it.
 */
export const ensureAssignmentAccepted = async ({ test, testId, studentId, deps = {} }) => {
  let isCompanyTest = isCompanyTrackTest(test);
  if (!isCompanyTest && test.testSeriesId) {
    const loadSeries =
      deps.loadSeries ||
      (async (id) => {
        const TestSeries = (await import("../../../models/testSeries.model.js")).default;
        return TestSeries.findById(id).select("category companyId").lean();
      });
    const series = await loadSeries(test.testSeriesId);
    isCompanyTest = isCompanyTrackTest(test, series);
  }

  const TestAssignment =
    deps.TestAssignment || (await import("../../../models/testAssignment.model.js")).default;
  let assignment = await TestAssignment.findOne({ testId, studentId });
  if (!assignment && isCompanyTest) {
    assignment = await TestAssignment.create({
      testId,
      studentId,
      status: "ACCEPTED",
      acceptedAt: new Date(),
    });
  }

  return Boolean(assignment && assignment.acceptedAt && assignment.status !== "DECLINED");
};
