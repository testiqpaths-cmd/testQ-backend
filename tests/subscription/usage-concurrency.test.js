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
import crypto from "crypto";
import {
  checkFeatureAccess,
  commitFeatureUsage,
  releaseFeatureUsage,
  extendFeatureLease,
  reconcileStaleReservations,
  withSubscriptionTransaction,
} from "../../src/modules/subscription/services/subscription.service.js";
import UserFeatureUsage from "../../src/modules/subscription/models/UserFeatureUsage.model.js";
import FeatureReservation from "../../src/modules/subscription/models/FeatureReservation.model.js";
import PlanFeature from "../../src/modules/subscription/models/PlanFeature.model.js";
import TestModel from "../../src/models/test.model.js";

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

  test("releaseFeatureUsage is idempotent and prevents duplicate refunds with unique reservationId", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "REFUND_TEST_FEATURE", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 5 });

    const reservationId = crypto.randomUUID();

    // 1. Reserve 1 use with reservationId
    const reserved = await checkFeatureAccess(student._id, feature.key, 1, reservationId);
    assert.equal(reserved, true);

    const usageAfterReserve = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterReserve.usedCount, 1);

    // 2. First release call succeeds and decrements usedCount to 0
    await releaseFeatureUsage(student._id, feature.key, 1, reservationId);

    const usageAfterRelease1 = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterRelease1.usedCount, 0);

    // 3. Second duplicate release call with the same reservationId MUST NOT decrement further (remains 0)
    await releaseFeatureUsage(student._id, feature.key, 1, reservationId);

    const usageAfterRelease2 = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterRelease2.usedCount, 0, "Duplicate release must not over-refund usage");

    // 4. Also verify request-level polymorphism and duplicate guard
    const fakeReq = {
      featureReservation: {
        reservationId: crypto.randomUUID(),
        featureKey: feature.key,
        userId: student._id,
        count: 1,
        released: false,
      },
    };

    await checkFeatureAccess(student._id, feature.key, 1, fakeReq.featureReservation.reservationId);
    const usageBeforeReqRelease = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageBeforeReqRelease.usedCount, 1);

    await releaseFeatureUsage(fakeReq);
    assert.equal(fakeReq.featureReservation.released, true);

    const usageAfterReqRelease1 = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageAfterReqRelease1.usedCount, 0);

    // Calling releaseFeatureUsage(fakeReq) again must do nothing
    await releaseFeatureUsage(fakeReq);
    const usageAfterReqRelease2 = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageAfterReqRelease2.usedCount, 0, "Repeated release on req must be a no-op");
  });

  test("60 simultaneous reservations: All 60 reservations persist in FeatureReservation without truncation", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "LARGE_BURST_FEATURE", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 100 });

    const reservationIds = Array.from({ length: 60 }, () => crypto.randomUUID());

    // Execute 60 reservations
    for (const resId of reservationIds) {
      await checkFeatureAccess(student._id, feature.key, 1, resId);
    }

    // Verify all 60 are preserved in FeatureReservation
    const savedReservations = await FeatureReservation.find({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(savedReservations.length, 60, "All 60 reservations must exist in dedicated collection");

    // Releasing the 1st reservation (which in a $slice: -50 array would have been pruned) works cleanly
    await releaseFeatureUsage(student._id, feature.key, 1, reservationIds[0]);
    const usageAfterPrunedRelease = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterPrunedRelease.usedCount, 59);
  });

  test("commitFeatureUsage transitions PENDING to COMMITTED and prevents subsequent release refund", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "COMMIT_TEST_FEATURE", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const reservationId = crypto.randomUUID();
    await checkFeatureAccess(student._id, feature.key, 1, reservationId);

    const committed = await commitFeatureUsage(reservationId, "resource_123", "Test");
    assert.equal(committed.status, "COMMITTED");
    assert.equal(committed.targetResourceId, "resource_123");

    // Subsequent release attempt on committed reservation MUST NOT decrement usedCount
    await releaseFeatureUsage(student._id, feature.key, 1, reservationId);
    const usageAfterCommitRelease = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterCommitRelease.usedCount, 1, "Committed reservation must not be refunded");
  });

  test("Crash recovery: Server crashes after reservation (no test created) -> reconcileStaleReservations detects missing entity, transitions to EXPIRED, and refunds usage", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "CREATE_TEST", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const reservationId = crypto.randomUUID();
    // Simulate expired lease (1 second lease that is now in the past)
    await checkFeatureAccess(student._id, feature.key, 1, reservationId, {
      leaseMs: -1000,
    });

    const usageBeforeRecovery = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageBeforeRecovery.usedCount, 1);

    // Run recovery worker (no test exists in TestModel)
    const recoveryResult = await reconcileStaleReservations({ batchSize: 10 });
    assert.equal(recoveryResult.released, 1);
    assert.equal(recoveryResult.committed, 0);

    const reservationDoc = await FeatureReservation.findOne({ reservationId });
    assert.equal(reservationDoc.status, "EXPIRED");

    const usageAfterRecovery = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterRecovery.usedCount, 0, "Usage must be refunded for unconfirmed crashed request");
  });

  test("Crash recovery: Server crashes after test creation (test exists uncommitted) -> reconcileStaleReservations detects created test and COMMITS without refunding", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "CREATE_TEST", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const reservationId = crypto.randomUUID();
    // Expired lease
    await checkFeatureAccess(student._id, feature.key, 1, reservationId, {
      leaseMs: -1000,
    });

    // Simulate test entity was created right at reservation time before crash
    await TestModel.create({
      title: "Crashed Node Created Test",
      createdBy: {
        userId: student._id,
        role: "STUDENT",
      },
      duration: 30,
      totalQuestions: 5,
      totalMarks: 5,
      marksPerQuestion: 1,
      visibility: "PUBLIC",
      scheduleType: "IMMEDIATE",
      sections: [],
    });

    // Run recovery worker
    const recoveryResult = await reconcileStaleReservations({ batchSize: 10 });
    assert.equal(recoveryResult.committed, 1, "Must commit confirmed created entity");
    assert.equal(recoveryResult.released, 0, "Must not refund completed operation");

    const reservationDoc = await FeatureReservation.findOne({ reservationId });
    assert.equal(reservationDoc.status, "COMMITTED");

    const usageAfterRecovery = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usageAfterRecovery.usedCount, 1, "Usage must remain charged for confirmed test");
  });

  test("Legitimate long-running operation with active lease -> reconcileStaleReservations skips it", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "AI_INTERVIEW", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const reservationId = crypto.randomUUID();
    // Lease expires 30 minutes in the future (active long-running interview)
    await checkFeatureAccess(student._id, feature.key, 1, reservationId, {
      leaseMs: 30 * 60 * 1000,
    });

    const recoveryResult = await reconcileStaleReservations({ batchSize: 10 });
    assert.equal(recoveryResult.processed, 0, "Active lease must be ignored by recovery worker");

    const reservationDoc = await FeatureReservation.findOne({ reservationId });
    assert.equal(reservationDoc.status, "PENDING");
  });

  test("Two recovery workers run simultaneously -> Exactly one refunds, preventing duplicate refund", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "RECOVERY_RACE_FEATURE", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const reservationId = crypto.randomUUID();
    await checkFeatureAccess(student._id, feature.key, 1, reservationId, {
      leaseMs: -1000,
    });

    // Launch two recovery workers concurrently
    const [result1, result2] = await Promise.all([
      reconcileStaleReservations({ batchSize: 10 }),
      reconcileStaleReservations({ batchSize: 10 }),
    ]);

    const totalReleased = result1.released + result2.released;
    assert.equal(totalReleased, 1, "Exactly one worker must claim and refund the stale reservation");

    const usage = await UserFeatureUsage.findOne({
      userId: student._id,
      featureId: feature._id,
    });
    assert.equal(usage.usedCount, 0, "Usage count must be 0 (no duplicate refund)");
  });

  test("Transactional integrity: simulated crash/abort mid-operation rolls back both documents", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "TX_TEST_FEATURE", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const reservationId = crypto.randomUUID();
    await checkFeatureAccess(student._id, feature.key, 1, reservationId);

    const usageBefore = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageBefore.usedCount, 1);

    // Simulate an aborted transaction where reservation was updated to RELEASED but second op throws
    let txThrew = false;
    try {
      await withSubscriptionTransaction(async (session) => {
        await FeatureReservation.findOneAndUpdate(
          { reservationId, status: "PENDING" },
          { $set: { status: "RELEASED" } },
          { session }
        );
        // Simulate unexpected crash / host kill signal
        throw new Error("SIMULATED_WORKER_CRASH_MID_TRANSACTION");
      });
    } catch (err) {
      if (err.message === "SIMULATED_WORKER_CRASH_MID_TRANSACTION") {
        txThrew = true;
      }
    }

    assert.equal(txThrew, true);

    // Verify reservation remains PENDING because transaction aborted cleanly
    const reservationDoc = await FeatureReservation.findOne({ reservationId });
    assert.equal(reservationDoc.status, "PENDING", "Reservation status must remain PENDING on transaction abort");

    // Verify usage remained 1
    const usageAfter = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageAfter.usedCount, 1, "Usage count must remain untouched on transaction abort");
  });

  test("Crash recovery with exact correlation ID: two simultaneous test creations recover and commit their respective reservations without cross-contamination", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "CREATE_TEST", type: "USAGE" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 10 });

    const resA = crypto.randomUUID();
    const resB = crypto.randomUUID();

    // Two parallel reservations by the same student
    await checkFeatureAccess(student._id, feature.key, 1, resA, { leaseMs: -1000 });
    await checkFeatureAccess(student._id, feature.key, 1, resB, { leaseMs: -1000 });

    // Resource A was created with reservationId resA
    const testA = await TestModel.create({
      title: "Simultaneous Test A",
      reservationId: resA,
      createdBy: { userId: student._id, role: "STUDENT" },
      duration: 30,
      totalQuestions: 5,
      totalMarks: 5,
      marksPerQuestion: 1,
      visibility: "PUBLIC",
      scheduleType: "IMMEDIATE",
      sections: [],
    });

    // Resource B was created with reservationId resB
    const testB = await TestModel.create({
      title: "Simultaneous Test B",
      reservationId: resB,
      createdBy: { userId: student._id, role: "STUDENT" },
      duration: 30,
      totalQuestions: 5,
      totalMarks: 5,
      marksPerQuestion: 1,
      visibility: "PUBLIC",
      scheduleType: "IMMEDIATE",
      sections: [],
    });

    // Run recovery worker
    const recoveryResult = await reconcileStaleReservations({ batchSize: 10 });
    assert.equal(recoveryResult.committed, 2, "Both tests must be discovered and committed");
    assert.equal(recoveryResult.released, 0, "Neither test must be refunded");

    const docA = await FeatureReservation.findOne({ reservationId: resA });
    const docB = await FeatureReservation.findOne({ reservationId: resB });
    assert.equal(docA.status, "COMMITTED");
    assert.equal(docB.status, "COMMITTED");

    // Total usage count must remain 2 (both consumed)
    const usage = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usage.usedCount, 2);
  });

  test("Dynamic plan limit updates: changing PlanFeature.limit immediately affects subscriber without altering historic usage count", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const plan = await createPlanFixture(studentRole._id);
    await createSubscriptionFixture(student._id, plan._id);

    const feature = await createFeatureFixture({ key: "DYNAMIC_PLAN_FEATURE", type: "USAGE" });
    const pf = await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 5 });

    // 1. Consume 3 uses under initial limit of 5
    for (let i = 0; i < 3; i++) {
      await checkFeatureAccess(student._id, feature.key, 1, crypto.randomUUID());
    }

    const usageAfter3 = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageAfter3.usedCount, 3);

    // 2. Admin increases limit from 5 to 10 in PlanFeature
    await PlanFeature.updateOne({ _id: pf._id }, { $set: { limit: 10 } });

    // Can immediately make 7 more reservations without code change or user logout
    for (let i = 0; i < 7; i++) {
      await checkFeatureAccess(student._id, feature.key, 1, crypto.randomUUID());
    }

    const usageAfter10 = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usageAfter10.usedCount, 10);

    // Attempting 11th request under limit 10 fails with 402
    await assert.rejects(
      async () => checkFeatureAccess(student._id, feature.key, 1, crypto.randomUUID()),
      (err) => err.statusCode === 402 && err.code === "FEATURE_LIMIT_REACHED"
    );

    // 3. Admin reduces limit from 10 to 5 while usedCount is 10
    await PlanFeature.updateOne({ _id: pf._id }, { $set: { limit: 5 } });

    // Existing usedCount is preserved (NEVER wiped or reset)
    const usagePreserved = await UserFeatureUsage.findOne({ userId: student._id, featureId: feature._id });
    assert.equal(usagePreserved.usedCount, 10);

    // New request is blocked with 402 and remaining: 0
    await assert.rejects(
      async () => checkFeatureAccess(student._id, feature.key, 1, crypto.randomUUID()),
      (err) => {
        assert.equal(err.statusCode, 402);
        assert.equal(err.code, "FEATURE_LIMIT_REACHED");
        assert.equal(err.data.used, 10);
        assert.equal(err.data.limit, 5);
        assert.equal(err.data.remaining, 0);
        return true;
      }
    );

    // 4. Admin sets limit to 0 -> immediately blocked with 402
    await PlanFeature.updateOne({ _id: pf._id }, { $set: { limit: 0 } });
    await assert.rejects(
      async () => checkFeatureAccess(student._id, feature.key, 1, crypto.randomUUID()),
      (err) => err.statusCode === 402
    );

    // 5. Admin sets limit to null -> immediately unlimited
    await PlanFeature.updateOne({ _id: pf._id }, { $set: { limit: null } });
    const unlimitedAccess = await checkFeatureAccess(student._id, feature.key, 1, crypto.randomUUID());
    assert.equal(unlimitedAccess, true);
  });
});

