import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import env from "../../src/config/env.js";
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
  getUserUsageDetails,
  validatePlanEligibility,
  assignPlanByAdmin,
  verifyRazorpayPayment,
  processRazorpayWebhookEvent,
} from "../../src/modules/subscription/services/subscription.service.js";
import Payment from "../../src/modules/subscription/models/Payment.model.js";
import UserSubscription from "../../src/modules/subscription/models/UserSubscription.model.js";
import UserFeatureUsage from "../../src/modules/subscription/models/UserFeatureUsage.model.js";

const expect402 = (pattern, code) => (err) => {
  assert.equal(err.statusCode, 402);
  if (pattern) assert.match(err.message, pattern);
  if (code) assert.equal(err.code ?? err.errorCode ?? code, code);
  return true;
};

describe("Suite 5: Organization plans, per-student allowances & cash assignment", () => {
  let studentRole;
  let orgRole;

  // An organization as created by user.service.createOrganization: the
  // Organization document plus an ORGANIZATION login pointing at it.
  const createOrg = async () => {
    const org = await createOrganizationFixture({ studentLimit: null });
    const orgUser = await createUserFixture({ role: "ORGANIZATION", organizationId: org._id });
    return { org, orgUser };
  };

  before(async () => {
    await connectTestDB();
    // CASH payments have no razorpayOrderId; make sure the sparse unique
    // index from the model is in place (what the migration does in prod).
    await Payment.syncIndexes();
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

  test("organization without any plan (and no default org plan) keeps unrestricted access, as do its students", async () => {
    const { org, orgUser } = await createOrg();
    const student = await createUserFixture({ role: "STUDENT", organizationId: org._id });
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });

    assert.equal(await checkFeatureAccess(orgUser._id, feature.key, 1), true);
    assert.equal(await checkFeatureAccess(student._id, feature.key, 1), true);
    assert.equal(await getUserUsageDetails(student._id), null);
  });

  test("organization plan limits the organization account itself", async () => {
    const { orgUser } = await createOrg();
    const plan = await createPlanFixture(orgRole._id);
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 2, resetType: "LIFETIME" });
    await createSubscriptionFixture(orgUser._id, plan._id);

    await checkFeatureAccess(orgUser._id, feature.key, 1);
    await checkFeatureAccess(orgUser._id, feature.key, 1);
    await assert.rejects(
      () => checkFeatureAccess(orgUser._id, feature.key, 1),
      expect402(/maximum limit \(2\).*your current plan/i)
    );
  });

  test("each organization student gets their own per-student allowance from the org plan", async () => {
    const { org, orgUser } = await createOrg();
    const plan = await createPlanFixture(orgRole._id);
    const feature = await createFeatureFixture({ key: "AI_INTERVIEW" });
    await createPlanFeatureFixture(plan._id, feature._id, {
      enabled: true,
      limit: 100,
      studentEnabled: true,
      studentLimit: 1,
      studentResetType: "LIFETIME",
    });
    await createSubscriptionFixture(orgUser._id, plan._id);

    const alice = await createUserFixture({ role: "STUDENT", organizationId: org._id });
    const bob = await createUserFixture({ role: "STUDENT", organizationId: org._id });

    await checkFeatureAccess(alice._id, feature.key, 1);
    await assert.rejects(
      () => checkFeatureAccess(alice._id, feature.key, 1),
      expect402(/organization's plan.*contact your organization/i)
    );
    // Bob's counter is independent of Alice's
    assert.equal(await checkFeatureAccess(bob._id, feature.key, 1), true);

    const details = await getUserUsageDetails(alice._id);
    assert.equal(details.managedByOrganization, true);
    const aiInterview = details.features.find((f) => f.key === "AI_INTERVIEW");
    assert.equal(aiInterview.limit, 1);
    assert.equal(aiInterview.used, 1);
    assert.equal(aiInterview.blocked, true);
    assert.equal(aiInterview.blockReason, "LIMIT_REACHED");
  });

  test("org students are blocked from a feature whose per-student access is off, even if the org has it", async () => {
    const { org, orgUser } = await createOrg();
    const plan = await createPlanFixture(orgRole._id);
    const feature = await createFeatureFixture({ key: "USER_MANAGEMENT", type: "BOOLEAN" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: null });
    await createSubscriptionFixture(orgUser._id, plan._id);
    const student = await createUserFixture({ role: "STUDENT", organizationId: org._id });

    assert.equal(await checkFeatureAccess(orgUser._id, feature.key), true);
    await assert.rejects(
      () => checkFeatureAccess(student._id, feature.key),
      expect402(/disabled on your organization's plan/i)
    );
  });

  test("expired organization plan blocks its students too", async () => {
    const { org, orgUser } = await createOrg();
    const plan = await createPlanFixture(orgRole._id);
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });
    await createPlanFeatureFixture(plan._id, feature._id, { studentEnabled: true, studentLimit: null });
    await createSubscriptionFixture(orgUser._id, plan._id, { expiresAt: new Date(Date.now() - 1000) });
    const student = await createUserFixture({ role: "STUDENT", organizationId: org._id });

    await assert.rejects(
      () => checkFeatureAccess(student._id, feature.key),
      expect402(/organization's plan has expired/i)
    );
  });

  test("default organization plan is auto-assigned to organizations without one", async () => {
    const { orgUser } = await createOrg();
    const plan = await createPlanFixture(orgRole._id, { isDefault: true, price: 0, durationDays: null });
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });
    await createPlanFeatureFixture(plan._id, feature._id, { enabled: true, limit: 0 });

    await assert.rejects(() => checkFeatureAccess(orgUser._id, feature.key, 1), expect402());
    const sub = await UserSubscription.findOne({ userId: orgUser._id });
    assert.equal(String(sub.planId), String(plan._id));
  });

  test("expired paid plan falls back to the default plan instead of crashing on the unique userId index", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const freePlan = await createPlanFixture(studentRole._id, { isDefault: true, price: 0, durationDays: null });
    const paidPlan = await createPlanFixture(studentRole._id, { price: 99 });
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });
    await createPlanFeatureFixture(freePlan._id, feature._id, { enabled: true, limit: null });
    await createSubscriptionFixture(student._id, paidPlan._id, {
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 1000),
    });

    assert.equal(await checkFeatureAccess(student._id, feature.key), true);
    const sub = await UserSubscription.findOne({ userId: student._id });
    assert.equal(String(sub.planId), String(freePlan._id));
    assert.equal(sub.status, "ACTIVE");
  });

  test("plan eligibility: organizations buy ORGANIZATION plans, org students can't buy", async () => {
    const { org, orgUser } = await createOrg();
    const orgPlan = await createPlanFixture(orgRole._id);
    const studentPlan = await createPlanFixture(studentRole._id);
    const orgStudent = await createUserFixture({ role: "STUDENT", organizationId: org._id });

    const { plan } = await validatePlanEligibility(orgUser._id, orgPlan._id);
    assert.equal(String(plan._id), String(orgPlan._id));
    await assert.rejects(() => validatePlanEligibility(orgUser._id, studentPlan._id), /not available for organizations/i);
    await assert.rejects(() => validatePlanEligibility(orgStudent._id, studentPlan._id), /managed by your organization/i);
  });

  test("admin assigns a paid plan in CASH: records a PAID cash payment with an editable amount", async () => {
    const admin = await createUserFixture({ role: "IQPATH_ADMIN" });
    const { orgUser } = await createOrg();
    const student = await createUserFixture({ role: "STUDENT" });
    const orgPlan = await createPlanFixture(orgRole._id, { price: 4999 });
    const studentPlan = await createPlanFixture(studentRole._id, { price: 199 });

    await assignPlanByAdmin({
      adminId: admin._id,
      userId: orgUser._id,
      planId: orgPlan._id,
      paymentMode: "CASH",
      amount: 4500,
      note: "Receipt #12",
    });
    // Second CASH payment: proves the sparse razorpayOrderId index.
    await assignPlanByAdmin({ adminId: admin._id, userId: student._id, planId: studentPlan._id, paymentMode: "CASH" });

    const orgPayment = await Payment.findOne({ userId: orgUser._id });
    assert.equal(orgPayment.mode, "CASH");
    assert.equal(orgPayment.status, "PAID");
    assert.equal(orgPayment.amount, 450000);
    assert.equal(orgPayment.note, "Receipt #12");
    assert.equal(String(orgPayment.recordedBy), String(admin._id));
    assert.equal(orgPayment.razorpayOrderId, undefined);

    const studentPayment = await Payment.findOne({ userId: student._id });
    assert.equal(studentPayment.amount, 19900); // defaults to plan price

    const orgSub = await UserSubscription.findOne({ userId: orgUser._id });
    assert.equal(String(orgSub.planId), String(orgPlan._id));
    assert.equal(String(orgSub.lastPaymentId), String(orgPayment._id));
  });

  test("admin assignment rejects non-cash modes, role mismatches and org students", async () => {
    const admin = await createUserFixture({ role: "IQPATH_ADMIN" });
    const { org, orgUser } = await createOrg();
    const orgStudent = await createUserFixture({ role: "STUDENT", organizationId: org._id });
    const orgPlan = await createPlanFixture(orgRole._id, { price: 4999 });
    const studentPlan = await createPlanFixture(studentRole._id, { price: 199 });

    await assert.rejects(
      () => assignPlanByAdmin({ adminId: admin._id, userId: orgUser._id, planId: orgPlan._id, paymentMode: "RAZORPAY" }),
      /only record CASH/i
    );
    await assert.rejects(
      () => assignPlanByAdmin({ adminId: admin._id, userId: orgUser._id, planId: orgPlan._id }),
      /payment mode CASH/i
    );
    await assert.rejects(
      () => assignPlanByAdmin({ adminId: admin._id, userId: orgUser._id, planId: studentPlan._id, paymentMode: "CASH" }),
      /can't be assigned to a organization/i
    );
    await assert.rejects(
      () => assignPlanByAdmin({ adminId: admin._id, userId: orgStudent._id, planId: studentPlan._id, paymentMode: "CASH" }),
      /follows the organization's plan/i
    );
    assert.equal(await Payment.countDocuments(), 0);
  });

  test("changing an organization's plan resets its students' usage counters", async () => {
    const admin = await createUserFixture({ role: "IQPATH_ADMIN" });
    const { org, orgUser } = await createOrg();
    const planA = await createPlanFixture(orgRole._id, { price: 0 });
    const planB = await createPlanFixture(orgRole._id, { price: 0 });
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });
    await createPlanFeatureFixture(planA._id, feature._id, { studentEnabled: true, studentLimit: 1, studentResetType: "LIFETIME" });
    await createPlanFeatureFixture(planB._id, feature._id, { studentEnabled: true, studentLimit: 1, studentResetType: "LIFETIME" });
    await createSubscriptionFixture(orgUser._id, planA._id);
    const student = await createUserFixture({ role: "STUDENT", organizationId: org._id });

    await checkFeatureAccess(student._id, feature.key, 1);
    await assert.rejects(() => checkFeatureAccess(student._id, feature.key, 1), expect402());

    await assignPlanByAdmin({ adminId: admin._id, userId: orgUser._id, planId: planB._id });
    assert.equal(await UserFeatureUsage.countDocuments({ userId: student._id }), 0);
    assert.equal(await checkFeatureAccess(student._id, feature.key, 1), true);
  });
  // Razorpay order creation itself calls Razorpay's API; these tests start
  // from the CREATED Payment that createRazorpayOrder records (same approach
  // as payment-idempotency.test.js) and exercise the activation paths.
  const setupOrgCheckout = async () => {
    const { org, orgUser } = await createOrg();
    const freeOrgPlan = await createPlanFixture(orgRole._id, { price: 0, durationDays: null });
    const proPlan = await createPlanFixture(orgRole._id, { price: 4999, durationDays: 365 });
    const feature = await createFeatureFixture({ key: "CREATE_TEST" });
    await createPlanFeatureFixture(freeOrgPlan._id, feature._id, {
      enabled: true, limit: 1, resetType: "LIFETIME",
      studentEnabled: true, studentLimit: 1, studentResetType: "LIFETIME",
    });
    await createPlanFeatureFixture(proPlan._id, feature._id, {
      enabled: true, limit: 50, resetType: "LIFETIME",
      studentEnabled: true, studentLimit: 3, studentResetType: "LIFETIME",
    });
    await createSubscriptionFixture(orgUser._id, freeOrgPlan._id, { expiresAt: null });
    const student = await createUserFixture({ role: "STUDENT", organizationId: org._id });

    // Both are at their free-plan limit before paying
    await checkFeatureAccess(orgUser._id, feature.key, 1);
    await checkFeatureAccess(student._id, feature.key, 1);
    await assert.rejects(() => checkFeatureAccess(orgUser._id, feature.key, 1), expect402());
    await assert.rejects(() => checkFeatureAccess(student._id, feature.key, 1), expect402());

    // What createRazorpayOrder would have recorded for the organization
    await validatePlanEligibility(orgUser._id, proPlan._id);
    const orderId = `order_org_${Date.now()}`;
    await Payment.create({
      userId: orgUser._id,
      planId: proPlan._id,
      razorpayOrderId: orderId,
      amount: 499900,
      currency: "INR",
      status: "CREATED",
    });
    return { orgUser, student, proPlan, feature, orderId };
  };

  const assertOrgUpgraded = async ({ orgUser, student, proPlan, feature, orderId, via }) => {
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    assert.equal(payment.status, "PAID");
    assert.equal(payment.mode, "RAZORPAY");
    assert.equal(payment.verifiedVia, via);

    const sub = await UserSubscription.findOne({ userId: orgUser._id });
    assert.equal(String(sub.planId), String(proPlan._id));
    assert.equal(sub.status, "ACTIVE");
    assert.ok(sub.expiresAt > new Date(Date.now() + 360 * 86400000), "1-year expiry set");

    // Counters restarted; the org and its student now get the Pro allowances
    assert.equal(await checkFeatureAccess(orgUser._id, feature.key, 1), true);
    for (let i = 0; i < 3; i++) {
      assert.equal(await checkFeatureAccess(student._id, feature.key, 1), true);
    }
    await assert.rejects(() => checkFeatureAccess(student._id, feature.key, 1), expect402(/maximum limit \(3\)/));

    const orgView = await getUserUsageDetails(orgUser._id);
    assert.equal(orgView.plan.role, "ORGANIZATION");
    const createTest = orgView.features.find((f) => f.key === "CREATE_TEST");
    assert.equal(createTest.limit, 50);
    assert.deepEqual(createTest.studentAllowance, { enabled: true, limit: 3, resetType: "LIFETIME" });
  };

  test("organization pays through Razorpay (client verify): org plan activates, students get the new per-student allowance", async () => {
    const ctx = await setupOrgCheckout();
    const paymentId = `pay_org_${Date.now()}`;
    const signature = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(`${ctx.orderId}|${paymentId}`)
      .digest("hex");

    await verifyRazorpayPayment(ctx.orgUser._id, {
      razorpay_order_id: ctx.orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    });
    await assertOrgUpgraded({ ...ctx, via: "CLIENT" });
  });

  test("organization payment confirmed by the Razorpay webhook activates the org plan the same way", async () => {
    const ctx = await setupOrgCheckout();
    const rawBody = Buffer.from(
      JSON.stringify({
        event: "payment.captured",
        payload: { payment: { entity: { id: `pay_org_wh_${Date.now()}`, order_id: ctx.orderId } } },
      })
    );
    const signature = crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");

    const result = await processRazorpayWebhookEvent(rawBody, signature);
    assert.equal(result.handled, true);
    await assertOrgUpgraded({ ...ctx, via: "WEBHOOK" });
  });
});
