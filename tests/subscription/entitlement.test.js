import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { connectTestDB, disconnectTestDB } from "./helpers/setup.js";
import { clearTestDB } from "./helpers/cleanup.js";
import {
  createRoleFixture,
  createUserFixture,
  createOrganizationFixture,
  createFeatureFixture,
  createPlanFixture,
  createPlanFeatureFixture,
  createSubscriptionFixture,
} from "./helpers/fixtures.js";
import {
  checkFeatureAccess,
  validatePlanEligibility,
} from "../../src/modules/subscription/services/subscription.service.js";

describe("Suite 1: Entitlement Security & Plan Eligibility", () => {
  let studentRole;
  let orgRole;

  before(async () => {
    await connectTestDB();
    studentRole = await createRoleFixture("STUDENT");
    orgRole = await createRoleFixture("ORGANIZATION");
  });

  after(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    studentRole = await createRoleFixture("STUDENT");
    orgRole = await createRoleFixture("ORGANIZATION");
  });

  test("rejects unconfigured/unknown feature with 402 ApiError (Fail-Closed)", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    await assert.rejects(
      async () => {
        await checkFeatureAccess(student._id, "TOTALLY_UNKNOWN_FEATURE_XYZ");
      },
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.match(err.message, /not configured or recognized/i);
        return true;
      }
    );
  });

  test("rejects unmapped feature for student's plan with 402 ApiError", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "UNMAPPED_FEATURE" });
    // Intentionally no PlanFeature created for this plan

    await assert.rejects(
      async () => {
        await checkFeatureAccess(student._id, feature.key);
      },
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.match(err.message, /not included in your current plan/i);
        return true;
      }
    );
  });

  test("rejects disabled feature with 402 ApiError", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "DISABLED_FEATURE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: false });

    await assert.rejects(
      async () => {
        await checkFeatureAccess(student._id, feature.key);
      },
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.match(err.message, /disabled on your current plan/i);
        return true;
      }
    );
  });

  test("rejects zero-limit feature with 402 ApiError", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "ZERO_LIMIT_FEATURE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 0 });

    await assert.rejects(
      async () => {
        await checkFeatureAccess(student._id, feature.key);
      },
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.match(err.message, /not available in your current plan/i);
        return true;
      }
    );
  });

  test("unconditionally allows superuser IQPATH_ADMIN even without subscription", async () => {
    const admin = await createUserFixture({ role: "IQPATH_ADMIN" });
    const feature = await createFeatureFixture({ key: "ANY_FEATURE" });

    const result = await checkFeatureAccess(admin._id, feature.key);
    assert.equal(result, true);
  });

  test("unconditionally allows organization-affiliated student without personal subscription", async () => {
    const org = await createOrganizationFixture();
    const orgStudent = await createUserFixture({
      role: "STUDENT",
      organizationId: org._id,
    });
    const feature = await createFeatureFixture({ key: "ANY_STUDENT_FEATURE" });

    const result = await checkFeatureAccess(orgStudent._id, feature.key);
    assert.equal(result, true);
  });

  test("enforces organization student capacity on CAPACITY feature", async () => {
    const orgDoc = await createOrganizationFixture({ studentLimit: 2 });
    const orgUser = await createUserFixture({
      _id: orgDoc._id,
      role: "ORGANIZATION",
    });

    const capacityFeature = await createFeatureFixture({
      key: "MAX_STUDENTS",
      type: "CAPACITY",
    });

    // Currently 0 students: adding 1 should succeed
    const allowedFirst = await checkFeatureAccess(orgUser._id, capacityFeature.key, 1);
    assert.equal(allowedFirst, true);

    // Create 2 active students under this organization to fill capacity
    await createUserFixture({ role: "STUDENT", organizationId: orgUser._id, status: "ACTIVE" });
    await createUserFixture({ role: "STUDENT", organizationId: orgUser._id, status: "ACTIVE" });

    // Adding 1 more when at limit (2/2) must reject with 402
    await assert.rejects(
      async () => {
        await checkFeatureAccess(orgUser._id, capacityFeature.key, 1);
      },
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.match(err.message, /student limit reached/i);
        return true;
      }
    );
  });

  test("rejects invalid incrementBy parameter with 400 ApiError", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);
    const feature = await createFeatureFixture({ key: "INCREMENT_FEATURE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    await assert.rejects(
      async () => {
        await checkFeatureAccess(student._id, feature.key, -1);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /non-negative number/i);
        return true;
      }
    );
  });

  test("validatePlanEligibility rejects student attempting to acquire non-student plan", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const orgPlan = await createPlanFixture(orgRole._id);

    await assert.rejects(
      async () => {
        await validatePlanEligibility(student._id, orgPlan._id);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /not available for students/i);
        return true;
      }
    );
  });

  test("validatePlanEligibility rejects suspended account", async () => {
    const student = await createUserFixture({ role: "STUDENT", status: "SUSPENDED" });
    const plan = await createPlanFixture(studentRole._id);

    await assert.rejects(
      async () => {
        await validatePlanEligibility(student._id, plan._id);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /suspended/i);
        return true;
      }
    );
  });
});

