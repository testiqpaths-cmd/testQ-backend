import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { connectTestDB, disconnectTestDB } from "./helpers/setup.js";
import { clearTestDB } from "./helpers/cleanup.js";
import {
  createRoleFixture,
  createUserFixture,
  createPlanFixture,
} from "./helpers/fixtures.js";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  processRazorpayWebhookEvent,
} from "../../src/modules/subscription/services/subscription.service.js";
import Payment from "../../src/modules/subscription/models/Payment.model.js";
import UserSubscription from "../../src/modules/subscription/models/UserSubscription.model.js";
import env from "../../src/config/env.js";

describe("Suite 3: Payment Verification & Webhook Idempotency", () => {
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

  test("rejects verification with tampered HMAC signature with 400 ApiError", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const paidPlan = await createPlanFixture(studentRole._id, { price: 499 });

    const orderId = `order_test_${Date.now()}`;
    await Payment.create({
      userId: student._id,
      planId: paidPlan._id,
      razorpayOrderId: orderId,
      amount: 49900,
      currency: "INR",
      status: "CREATED",
    });

    await assert.rejects(
      async () => {
        await verifyRazorpayPayment(student._id, {
          razorpay_order_id: orderId,
          razorpay_payment_id: "pay_fake_123",
          razorpay_signature: "tampered_signature_hex",
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /payment verification failed/i);
        return true;
      }
    );

    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    assert.equal(payment.status, "FAILED");
    assert.equal(payment.failureReason, "Signature mismatch");
  });

  test("replaying payment verification is idempotent and does not create duplicate subscriptions", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const paidPlan = await createPlanFixture(studentRole._id, { price: 499, durationDays: 30 });

    const orderId = `order_test_${Date.now()}`;
    const paymentId = `pay_valid_${Date.now()}`;

    await Payment.create({
      userId: student._id,
      planId: paidPlan._id,
      razorpayOrderId: orderId,
      amount: 49900,
      currency: "INR",
      status: "CREATED",
    });

    const validSignature = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    // First verification call
    const firstResult = await verifyRazorpayPayment(student._id, {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature,
    });

    assert.ok(firstResult);
    assert.equal(firstResult.status, "ACTIVE");

    const paymentAfterFirst = await Payment.findOne({ razorpayOrderId: orderId });
    assert.equal(paymentAfterFirst.status, "PAID");

    // Second (duplicate/replay) verification call
    const secondResult = await verifyRazorpayPayment(student._id, {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature,
    });

    assert.ok(secondResult);
    assert.equal(secondResult.status, "ACTIVE");

    // Ensure strictly one subscription exists in database for this student
    const allSubs = await UserSubscription.find({ userId: student._id });
    assert.equal(allSubs.length, 1, "Replay must never create duplicate subscriptions");
    assert.equal(
      allSubs[0].expiresAt.getTime(),
      firstResult.expiresAt.getTime(),
      "Replay must never double-extend duration"
    );
  });

  test("rejects paid checkout for free plans (price: 0)", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const freePlan = await createPlanFixture(studentRole._id, { price: 0 });

    await assert.rejects(
      async () => {
        await createRazorpayOrder(student._id, freePlan._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /free plans do not require checkout/i);
        return true;
      }
    );
  });

  test("webhook signature rejection with 400 ApiError for invalid signature", async () => {
    const rawBody = Buffer.from(JSON.stringify({ event: "payment.captured" }));

    await assert.rejects(
      async () => {
        await processRazorpayWebhookEvent(rawBody, "invalid_webhook_sig");
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /invalid webhook signature/i);
        return true;
      }
    );
  });

  test("webhook processes payment.captured idempotently without duplicate activation", async () => {
    const student = await createUserFixture({ role: "STUDENT" });
    const paidPlan = await createPlanFixture(studentRole._id, { price: 499 });

    const orderId = `order_wh_${Date.now()}`;
    const paymentId = `pay_wh_${Date.now()}`;

    await Payment.create({
      userId: student._id,
      planId: paidPlan._id,
      razorpayOrderId: orderId,
      amount: 49900,
      currency: "INR",
      status: "CREATED",
    });

    const eventPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
          },
        },
      },
    };

    const rawBody = Buffer.from(JSON.stringify(eventPayload));
    const validWebhookSig = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    // First webhook delivery
    const res1 = await processRazorpayWebhookEvent(rawBody, validWebhookSig);
    assert.equal(res1.handled, true);

    const paymentAfterWh1 = await Payment.findOne({ razorpayOrderId: orderId });
    assert.equal(paymentAfterWh1.status, "PAID");
    assert.equal(paymentAfterWh1.verifiedVia, "WEBHOOK");

    // Second webhook delivery (re-transmission)
    const res2 = await processRazorpayWebhookEvent(rawBody, validWebhookSig);
    assert.equal(res2.handled, true);

    const subs = await UserSubscription.find({ userId: student._id });
    assert.equal(subs.length, 1, "Duplicate webhook must maintain single subscription");
  });
});

