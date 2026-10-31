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
import { checkFeatureAccess } from "../../src/modules/subscription/services/subscription.service.js";
import UserFeatureUsage from "../../src/modules/subscription/models/UserFeatureUsage.model.js";

describe("Suite 2: Usage Counters, Rolling Resets & Concurrency", () => {
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

  test("initializes usage without E11000 duplicate key error under concurrent first-use", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "FIRST_USE_CONCURRENT", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 100 });

    // Fire 10 simultaneous first-use requests
    const promises = Array.from({ length: 10 }).map(() =>
      checkFeatureAccess(student._id, feature.key, 1)
    );

    const results = await Promise.allSettled(promises);

    const rejections = results.filter((r) => r.status === "rejected");
    assert.equal(
      rejections.length,
      0,
      `Expected 0 rejections under concurrent first-use, but got ${rejections.length}: ${rejections[0]?.reason?.message}`
    );

    const usageRecords = await UserFeatureUsage.find({
      userId: student._id,
      featureId: feature._id,
    });

    assert.equal(usageRecords.length, 1, "Expected exactly 1 usage record to exist");
    assert.equal(usageRecords[0].usedCount, 10, "Expected usedCount to be exactly 10");
  });

  test("enforces usage limit strictly under concurrent access (N > limit)", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "STRICT_CONCURRENT_LIMIT", type: "USAGE" });
    // Configure limit of exactly 5
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 5 });

    // Fire 15 concurrent requests (each requesting 1 use)
    const promises = Array.from({ length: 15 }).map(() =>
      checkFeatureAccess(student._id, feature.key, 1)
    );

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 5, `Expected exactly 5 requests to succeed, got ${fulfilled.length}`);
    assert.equal(rejected.length, 10, `Expected exactly 10 requests to be rejected, got ${rejected.length}`);

    // Verify all rejections are 402 Limit Exceeded
    for (const r of rejected) {
      assert.equal(r.reason.statusCode, 402);
      assert.match(r.reason.message, /maximum limit/i);
    }

    // Verify final state in database
    const usageDoc = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });

    assert.ok(usageDoc);
    assert.equal(usageDoc.usedCount, 5, "Database usedCount must never exceed configured limit");
  });

  test("resets counter at exact boundary (now >= periodEnd)", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "ROLLING_BOUNDARY", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, {
      enabled: true,
      limit: 3,
      resetType: "DAILY",
    });

    // Seed existing usage record at limit (3/3), but periodEnd in the past
    const pastStart = new Date(Date.now() - 48 * 3600000);
    const pastEnd = new Date(Date.now() - 24 * 3600000);
    await UserFeatureUsage.create({
      userId: student._id,
      featureId: feature._id,
      usedCount: 3,
      periodStart: pastStart,
      periodEnd: pastEnd,
      lastUsedAt: pastStart,
    });

    // Access with incrementBy: 1 must trigger reset and succeed with usedCount = 1
    const allowed = await checkFeatureAccess(student._id, feature.key, 1);
    assert.equal(allowed, true);

    const updatedDoc = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });

    assert.ok(updatedDoc);
    assert.equal(updatedDoc.usedCount, 1, "Usage counter must reset to 1 after boundary expiration");
    assert.ok(updatedDoc.periodEnd > new Date(), "New periodEnd must be in the future");
  });

  test("unlimited feature (limit: null) and BOOLEAN bypass counter constraints", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const boolFeature = await createFeatureFixture({ key: "BOOL_FEATURE", type: "BOOLEAN" });
    await createPlanFeatureFixture(plan._id, boolFeature._id, { enabled: true, limit: null });

    const unlimitedUsageFeature = await createFeatureFixture({ key: "UNLIMITED_USAGE", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, unlimitedUsageFeature._id, { enabled: true, limit: null });

    assert.equal(await checkFeatureAccess(student._id, boolFeature.key, 1), true);
    assert.equal(await checkFeatureAccess(student._id, unlimitedUsageFeature.key, 50), true);
  });
});

