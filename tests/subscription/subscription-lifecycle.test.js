import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { connectTestDB, disconnectTestDB } from "./helpers/setup.js";
import { clearTestDB } from "./helpers/cleanup.js";
import {
  createRoleFixture,
  createUserFixture,
  createFeatureFixture,
  createPlanFixture,
  createPlanFeatureFixture,
  createSubscriptionFixture,
} from "./helpers/fixtures.js";
import {
  checkFeatureAccess,
  validatePlanEligibility,
  upgradeUserPlan,
} from "../../src/modules/subscription/services/subscription.service.js";
import UserSubscription from "../../src/modules/subscription/models/UserSubscription.model.js";

describe("Suite 4: Subscription Lifecycle & Expiration", () => {
  let studentRole;

  before(async () => {
    await connectTestDB();
    studentRole = await createRoleFixture("STUDENT");
  });

  after(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    studentRole = await createRoleFixture("STUDENT");
  });

  test("automatically transitions expired subscription to EXPIRED and blocks access", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    const feature = await createFeatureFixture({ key: "LIFECYCLE_FEATURE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true });

    // Subscription expired 10 minutes ago
    const expiredDate = new Date(Date.now() - 10 * 60000);
    const sub = await createSubscriptionFixture(student._id, plan._id, {
      status: "ACTIVE",
      expiresAt: expiredDate,
    });

    await assert.rejects(
      async () => {
        await checkFeatureAccess(student._id, feature.key);
      },
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.match(err.message, /expired/i);
        return true;
      }
    );

    // Verify DB status updated to EXPIRED
    const updatedSub = await UserSubscription.findById(sub._id);
    assert.equal(updatedSub.status, "EXPIRED");
  });

  test("soft-deactivated plan remains accessible to existing subscribers but blocked for new buyers", async () => {
    const existingStudent = await createUserFixture({ role: "STUDENT" });
    const newStudent = await createUserFixture({ role: "STUDENT" });

    // Plan soft-deactivated (active: false)
    const legacyPlan = await createPlanFixture(studentRole._id, { active: false });
    const feature = await createFeatureFixture({ key: "LEGACY_FEATURE" });
    await createPlanFeatureFixture(legacyPlan._id, feature._id, { enabled: true });

    // Existing student is subscribed
    await createSubscriptionFixture(existingStudent._id, legacyPlan._id, { status: "ACTIVE" });

    // Existing subscriber must retain feature access
    const allowed = await checkFeatureAccess(existingStudent._id, feature.key);
    assert.equal(allowed, true);

    // New student attempting to acquire this deactivated plan must be rejected
    await assert.rejects(
      async () => {
        await validatePlanEligibility(newStudent._id, legacyPlan._id);
      },
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /not found or inactive/i);
        return true;
      }
    );
  });

  test("first-time student can upgrade to free plan and receives active subscription", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const freePlan = await createPlanFixture(studentRole._id, { price: 0 });

    const newSub = await upgradeUserPlan(student._id, freePlan._id);
    assert.ok(newSub);
    assert.equal(newSub.status, "ACTIVE");
    assert.equal(String(newSub.planId), String(freePlan._id));

    const dbSub = await UserSubscription.findOne({ userId: student._id });
    assert.ok(dbSub);
    assert.equal(dbSub.status, "ACTIVE");
  });
});

