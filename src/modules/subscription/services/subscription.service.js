import mongoose from "mongoose";
import crypto from "crypto";
import Role from "../models/Role.model.js";
import Feature from "../models/Feature.model.js";
import Plan from "../models/Plan.model.js";
import PlanFeature from "../models/PlanFeature.model.js";
import UserSubscription from "../models/UserSubscription.model.js";
import UserFeatureUsage from "../models/UserFeatureUsage.model.js";
import Payment from "../models/Payment.model.js";
import User from "../../../modules/auth/models/User.model.js"; // Existing user model
import Organization from "../../../models/organization.model.js";
import { ApiError } from "../../../common/exceptions/ApiError.js";
import { getRazorpayClient } from "./razorpay.client.js";
import env from "../../../config/env.js";

/**
 * Gets the user's active subscription or assigns a default one if missing.
 *
 * The plan/subscription system only governs independent students — an
 * ORGANIZATION account and any STUDENT who belongs to one (user.organizationId
 * set) are unrestricted by it entirely. Organizations get a dedicated,
 * separate cap instead (Organization.studentLimit, enforced in
 * user.service.js's assertStudentLimitNotExceeded). Returning null here
 * (rather than only skipping *future* auto-creation) means any pre-existing
 * subscription docs for such users are also ignored going forward, and it
 * cascades cleanly: checkFeatureAccess() and getUserUsageDetails() below
 * both already fail-open/return null when this returns null.
 */
export const getUserSubscription = async (userId) => {
  const user = await User.findById(userId).select("role organizationId");
  if (!user) throw new ApiError(404, "User not found");

  const isOrganization = user.role === "ORGANIZATION";
  const isOrgAffiliatedStudent = user.role === "STUDENT" && Boolean(user.organizationId);
  if (isOrganization || isOrgAffiliatedStudent) {
    return null;
  }

  let sub = await UserSubscription.findOne({ userId, status: "ACTIVE" }).populate("planId");

  if (!sub || !sub.planId) {
    // Map user.role string to Role document
    const roleDoc = await Role.findOne({ name: user.role.toUpperCase() });
    if (!roleDoc) {
      console.warn(`[SubscriptionService] User ${userId} has unknown role: ${user.role}`);
      return null; // Cannot assign default
    }

    const defaultPlan = await Plan.findOne({ roleId: roleDoc._id, isDefault: true });
    if (!defaultPlan) {
      console.warn(`[SubscriptionService] No default plan found for role: ${roleDoc.name}`);
      return null;
    }

    if (sub) {
      sub.planId = defaultPlan._id;
      await sub.save();
      sub = await UserSubscription.findById(sub._id).populate("planId");
    } else {
      sub = new UserSubscription({
        userId: user._id,
        planId: defaultPlan._id,
        status: "ACTIVE",
      });
      await sub.save();
      sub = await UserSubscription.findById(sub._id).populate("planId");
    }
  }

  return sub;
};

/**
 * Single source of truth for "does this user have paid access" — shared by
 * the cross-app SSO verify endpoint (resume builder) and any future internal
 * gate, so both apply the exact same rule. Deliberately returns the plan
 * name/expiry alongside the boolean since callers that need to reject also
 * want to explain why (e.g. "renew your plan" vs "you're not logged in").
 *
 * Org accounts and org-affiliated students are treated as having access,
 * same "unmetered, not unpaid" rule getUserSubscription already applies to
 * them elsewhere — an org seat is a paid seat, just not metered per-student.
 */
export const getPaidAccessStatus = async (userId) => {
  const user = await User.findById(userId).select("role organizationId status");
  if (!user || user.status === "SUSPENDED") {
    return { hasActivePaidAccess: false, planName: null, subscriptionExpiresAt: null };
  }

  const isOrganization = user.role === "ORGANIZATION";
  const isOrgAffiliatedStudent = user.role === "STUDENT" && Boolean(user.organizationId);
  if (isOrganization || isOrgAffiliatedStudent) {
    return { hasActivePaidAccess: true, planName: "Organization", subscriptionExpiresAt: null };
  }

  const sub = await getUserSubscription(userId);
  if (!sub || sub.status !== "ACTIVE" || !sub.planId) {
    return { hasActivePaidAccess: false, planName: sub?.planId?.name ?? null, subscriptionExpiresAt: sub?.expiresAt ?? null };
  }
  if (sub.expiresAt && sub.expiresAt <= new Date()) {
    return { hasActivePaidAccess: false, planName: sub.planId?.name, subscriptionExpiresAt: sub.expiresAt };
  }

  // Access is governed purely by the RESUME_BUILDER PlanFeature toggle
  // (Subscriptions > Plans > Features in the admin panel) — an admin can
  // grant it to any plan, including the free tier, or revoke it from a paid
  // one. There is deliberately no "isPaidPlan" pre-condition gating this:
  // an earlier version required the plan to be non-default/priced>0 before
  // even checking the feature flag, which silently ignored an admin
  // enabling RESUME_BUILDER on the free plan. Fails CLOSED (unlike
  // checkFeatureAccess's fail-open default elsewhere in this file) if the
  // feature or its plan mapping doesn't exist — this gate protects paid
  // content, so "not configured" must mean "no access", not "unlimited
  // access".
  const feature = await Feature.findOne({ key: "RESUME_BUILDER", active: true });
  let resumeBuilderEnabled = false;
  if (feature) {
    const planFeature = await PlanFeature.findOne({ planId: sub.planId._id, featureId: feature._id });
    resumeBuilderEnabled = Boolean(planFeature?.enabled);
  }

  return {
    hasActivePaidAccess: resumeBuilderEnabled,
    planName: sub.planId?.name,
    subscriptionExpiresAt: sub.expiresAt,
  };
};

const addOneMonthSafe = (date) => {
  const d = new Date(date);
  const currentMonth = d.getMonth();
  d.setMonth(currentMonth + 1);
  // Month rollover guard (e.g. Jan 31 -> Mar 3 rolled back to Feb 28/29)
  if (d.getMonth() !== (currentMonth + 1) % 12) {
    d.setDate(0);
  }
  return d;
};

/**
 * Ensures feature reset logic is applied based on resetType
 */
const handleResetLogic = async (usageRecord, resetType) => {
  if (resetType === "LIFETIME") return;

  const now = new Date();
  
  if (usageRecord.periodEnd && now >= usageRecord.periodEnd) {
    // Reset needed (boundary: now >= periodEnd)
    usageRecord.usedCount = 0;
    usageRecord.periodStart = now;

    let nextEnd = new Date(now);
    if (resetType === "MONTHLY") nextEnd = addOneMonthSafe(now);
    else if (resetType === "YEARLY") nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    else if (resetType === "WEEKLY") nextEnd.setDate(nextEnd.getDate() + 7);
    else if (resetType === "DAILY") nextEnd.setDate(nextEnd.getDate() + 1);
    
    usageRecord.periodEnd = nextEnd;
  } else if (!usageRecord.periodEnd) {
    // Initialize period
    usageRecord.periodStart = now;
    let nextEnd = new Date(now);
    if (resetType === "MONTHLY") nextEnd = addOneMonthSafe(now);
    else if (resetType === "YEARLY") nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    else if (resetType === "WEEKLY") nextEnd.setDate(nextEnd.getDate() + 7);
    else if (resetType === "DAILY") nextEnd.setDate(nextEnd.getDate() + 1);
    
    usageRecord.periodEnd = nextEnd;
  }
};

/**
 * Centralized plan eligibility validation:
 * Ensures the user exists, is active, is an independent student,
 * and that the target plan exists, is active, and is intended for students.
 */
export const validatePlanEligibility = async (userId, planId) => {
  const user = await User.findById(userId).select("role organizationId status");
  if (!user || user.status === "SUSPENDED") {
    throw new ApiError(403, "Account suspended or not found");
  }

  // Only independent students are eligible to subscribe to individual plans
  if (user.role !== "STUDENT" || user.organizationId) {
    throw new ApiError(
      403,
      user.organizationId
        ? "Organization students have full access and do not need individual subscriptions."
        : "Only independent students can subscribe to individual plans."
    );
  }

  const plan = await Plan.findById(planId).populate("roleId");
  if (!plan || !plan.active) {
    throw new ApiError(404, "Plan not found or inactive");
  }

  // Plan must belong to STUDENT role
  if (plan.roleId?.name !== "STUDENT") {
    throw new ApiError(403, "This plan is not available for students.");
  }

  return { user, plan };
};

/**
 * Checks if a user has access to a specific feature.
 * For USAGE features, incrementBy will increment the usage record (default 0).
 * For CAPACITY features, incrementBy represents the new items being added, ensuring currentCount + incrementBy <= limit.
 */
export const checkFeatureAccess = async (userId, featureKey, incrementBy = 0) => {
  // 0. Validate incrementBy parameter
  if (typeof incrementBy !== "number" || isNaN(incrementBy) || incrementBy < 0) {
    throw new ApiError(400, "incrementBy must be a non-negative number.");
  }

  // 1. Resolve Feature (FAIL-CLOSED: unconfigured / unrecognized feature throws 402)
  const feature = await Feature.findOne({ key: featureKey, active: true });
  if (!feature) {
    throw new ApiError(402, `Feature '${featureKey}' is not configured or recognized.`);
  }

  // 2. Resolve User & Access Policy
  const user = await User.findById(userId).select("role organizationId status");
  if (!user || user.status === "SUSPENDED") {
    throw new ApiError(403, "Account suspended or not found.");
  }

  // Superuser bypass: IQPATH_ADMIN has unrestricted access
  if (user.role === "IQPATH_ADMIN") {
    return true;
  }

  // Organization-affiliated student bypass: students under an organization have full feature access
  if (user.role === "STUDENT" && user.organizationId) {
    return true;
  }

  // Organization accounts: full feature access, BUT CAPACITY limits (e.g. MAX_STUDENTS) are enforced
  if (user.role === "ORGANIZATION") {
    if (feature.type === "CAPACITY") {
      let currentCount = 0;
      if (feature.key === "MAX_STUDENTS") {
        const org = await Organization.findById(userId).select("studentLimit name").lean();
        if (org && org.studentLimit !== null && org.studentLimit !== undefined) {
          currentCount = await User.countDocuments({
            organizationId: userId,
            role: "STUDENT",
            status: "ACTIVE",
          });
          if (currentCount + incrementBy > org.studentLimit) {
            throw new ApiError(
              402,
              `Student limit reached for ${org.name || "this organization"}. You can add at most ${Math.max(
                0,
                org.studentLimit - currentCount
              )} more student(s) (limit: ${org.studentLimit}).`
            );
          }
        }
      }
    }
    return true;
  }

  // 3. Resolve Subscription for Independent Student
  const sub = await getUserSubscription(userId);
  if (!sub || sub.status !== "ACTIVE" || !sub.planId) {
    throw new ApiError(402, "No active subscription found. Please subscribe to access this feature.");
  }

  if (sub.expiresAt && sub.expiresAt <= new Date()) {
    sub.status = "EXPIRED";
    await sub.save();
    throw new ApiError(402, "Your subscription has expired. Please renew or upgrade to continue.");
  }

  const planId = sub.planId._id ? sub.planId._id : sub.planId;

  // 4. Resolve Plan Feature Config (FAIL-CLOSED)
  const planFeature = await PlanFeature.findOne({ planId, featureId: feature._id });
  
  if (!planFeature) {
    throw new ApiError(402, `Access to ${feature.displayName} is not included in your current plan.`);
  }

  if (!planFeature.enabled) {
    throw new ApiError(402, `Access to ${feature.displayName} is disabled on your current plan.`);
  }

  const limit = planFeature.limit;
  if (limit === null) {
    return true; // Unlimited
  }

  if (limit === 0) {
    throw new ApiError(402, `Access to ${feature.displayName} is not available in your current plan.`);
  }

  // 5. Handle based on feature type
  if (feature.type === "BOOLEAN") {
    return true;
  }

  if (feature.type === "CAPACITY") {
    let currentCount = 0;
    if (feature.key === "MAX_STUDENTS") {
      currentCount = await User.countDocuments({ organizationId: userId, status: "ACTIVE" });
    }
    
    if (currentCount + incrementBy > limit) {
      throw new ApiError(402, `Limit exceeded! You can only add ${limit - currentCount} more ${feature.displayName} on your current plan. Please upgrade to continue.`);
    }
    return true;
  }

  // 6. Handle USAGE Features: atomic upsert / retrieval to prevent concurrent first-use E11000 race
  let usageRecord;
  try {
    usageRecord = await UserFeatureUsage.findOneAndUpdate(
      { userId, featureId: feature._id },
      {
        $setOnInsert: {
          userId,
          featureId: feature._id,
          usedCount: 0,
          periodStart: new Date(),
          periodEnd: null,
          lastUsedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // In rare race where unique index collides before upsert commits, retrieve existing doc
    if (err.code === 11000) {
      usageRecord = await UserFeatureUsage.findOne({ userId, featureId: feature._id });
    } else {
      throw err;
    }
  }

  const now = new Date();
  const neededReset = (usageRecord.periodEnd && now >= usageRecord.periodEnd) || !usageRecord.periodEnd;
  if (neededReset) {
    await handleResetLogic(usageRecord, planFeature.resetType);
    await usageRecord.save();
  }

  // If incrementBy === 0, just check access without consuming usage
  if (incrementBy === 0) {
    if (usageRecord.usedCount >= limit) {
      throw new ApiError(402, `You have reached the maximum limit (${limit}) for ${feature.displayName} on your current plan. Please upgrade to continue.`);
    }
    return true;
  }

  // Atomic conditional increment: guarantees concurrency safety at the database level
  const updatedUsage = await UserFeatureUsage.findOneAndUpdate(
    {
      _id: usageRecord._id,
      usedCount: { $lte: limit - incrementBy },
    },
    {
      $inc: { usedCount: incrementBy },
      $set: { lastUsedAt: new Date() },
    },
    { new: true }
  );

  if (!updatedUsage) {
    throw new ApiError(402, `You have reached the maximum limit (${limit}) for ${feature.displayName} on your current plan. Please upgrade to continue.`);
  }

  return true;
};

/**
 * Returns a detailed breakdown of a user's subscription and usage for the dashboard.
 */
export const getUserUsageDetails = async (userId) => {
  const sub = await getUserSubscription(userId);
  if (!sub || !sub.planId) return null;

  // usageRecords only needs userId (already known) — it doesn't depend on
  // `plan`, so fetch it in parallel instead of after. planFeatures does
  // depend on plan._id, so it still has to wait for that one.
  const targetPlanId = sub.planId._id ? sub.planId._id : sub.planId;
  const [plan, usageRecords] = await Promise.all([
    Plan.findById(targetPlanId).populate("roleId"),
    UserFeatureUsage.find({ userId }),
  ]);
  if (!plan) return null;
  const planFeatures = await PlanFeature.find({ planId: plan._id }).populate("featureId");

  const featureDetails = await Promise.all(
    planFeatures.map(async (pf) => {
      const feature = pf.featureId;
      if (!feature) return null;
      if (feature.key === "MAX_STUDENTS" && plan.roleId.name !== "ORGANIZATION") return null;

      const usage = usageRecords.find((u) => u.featureId.toString() === feature._id.toString());
      
      let usedCount = usage ? usage.usedCount : 0;
      
      if (feature.type === "CAPACITY") {
        if (feature.key === "MAX_STUDENTS") {
          usedCount = await User.countDocuments({ organizationId: userId, status: "ACTIVE" });
        }
      } else if (usage) {
         // simulate reset logic just for display
         const simUsage = new UserFeatureUsage(usage);
         await handleResetLogic(simUsage, pf.resetType);
         usedCount = simUsage.usedCount;
      }

      return {
        key: feature.key,
        displayName: feature.displayName,
        description: feature.description,
        type: feature.type,
        enabled: pf.enabled,
        limit: pf.limit,
        used: usedCount,
        remaining: pf.limit === null ? "Unlimited" : Math.max(0, pf.limit - usedCount),
        resetType: pf.resetType,
        periodEnd: usage ? usage.periodEnd : null,
      };
    })
  );

  return {
    subscriptionId: sub._id,
    plan: {
      id: plan._id,
      name: plan.name,
      description: plan.description,
      role: plan.roleId.name,
      icon: plan.icon,
      price: plan.price ?? 0,
      currency: plan.currency || "INR",
      durationDays: plan.durationDays,
      isDefault: plan.isDefault,
    },
    status: sub.status,
    features: featureDetails.filter(f => f !== null),
  };
};

/**
 * Simulates upgrading a user's plan.
 *
 * Accepts an optional mongodb session so callers that need this write to
 * participate in a larger transaction (the paid-checkout paths below) can
 * pass one through; the free-plan and admin-assign call sites simply don't
 * pass one, and every mongoose call here treats `session: undefined`
 * identically to not being in a transaction at all.
 */
export const upgradeUserPlan = async (userId, newPlanId, { session } = {}) => {
  const plan = await Plan.findById(newPlanId).session(session);
  if (!plan) throw new ApiError(404, "Plan not found");

  let sub = await UserSubscription.findOne({ userId }).session(session);
  if (sub) {
    sub.planId = plan._id;
    sub.status = "ACTIVE";
    sub.startsAt = new Date();
    sub.expiresAt = plan.durationDays ? new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000) : null;
    await sub.save({ session });
  } else {
    sub = new UserSubscription({
      userId,
      planId: plan._id,
      status: "ACTIVE",
      startsAt: new Date(),
      expiresAt: plan.durationDays ? new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000) : null,
    });
    await sub.save({ session });
  }

  // Clear usage when switching plans (optional, but requested for clean start)
  await UserFeatureUsage.deleteMany({ userId }, { session });

  return sub;
};

/**
 * Same activation as upgradeUserPlan, plus stamping which Payment paid for
 * it. Kept as a thin wrapper (rather than adding a paymentDoc param to
 * upgradeUserPlan itself) so the free-plan and admin-assign call sites,
 * which have no payment to attach, are completely unaffected.
 */
export const upgradeUserPlanWithPayment = async (userId, planId, paymentDoc, { session } = {}) => {
  const sub = await upgradeUserPlan(userId, planId, { session });
  sub.lastPaymentId = paymentDoc._id;
  sub.razorpayOrderId = paymentDoc.razorpayOrderId;
  sub.razorpayPaymentId = paymentDoc.razorpayPaymentId;
  await sub.save({ session });
  return sub;
};

// Constant-time comparison guarded against a length mismatch — Node's
// crypto.timingSafeEqual throws (rather than returning false) when the two
// buffers differ in length, which an attacker-controlled signature string
// easily triggers.
const safeCompare = (a, b) => {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Creates a Razorpay order for a paid plan and records the checkout attempt.
 * Free plans (price 0) are rejected here even if the frontend's own
 * price===0 branch is somehow bypassed — a self-service checkout must never
 * be able to originate a ₹0/$0 Razorpay order.
 */
export const createRazorpayOrder = async (userId, planId) => {
  const { plan } = await validatePlanEligibility(userId, planId);
  if (plan.price === 0) {
    throw new ApiError(400, "Free plans do not require checkout — use the upgrade endpoint instead.");
  }

  // Smallest-currency-unit conversion (paise for INR, cents for USD, etc.)
  // — currency-agnostic, no INR-specific branching. Whatever plan.currency
  // is set to is passed straight through to Razorpay verbatim.
  const amount = Math.round(plan.price * 100);

  const order = await getRazorpayClient().orders.create({
    amount,
    currency: plan.currency,
    receipt: `sub_${userId}_${Date.now()}`,
    notes: { userId: String(userId), planId: String(planId) },
  });

  await Payment.create({
    userId,
    planId: plan._id,
    razorpayOrderId: order.id,
    amount,
    currency: plan.currency,
    status: "CREATED",
  });

  return {
    orderId: order.id,
    amount,
    currency: plan.currency,
    keyId: env.RAZORPAY_KEY_ID,
    planId: String(plan._id),
    planName: plan.name,
  };
};

/**
 * Verifies a Razorpay checkout success callback and activates the plan.
 * The `status: "CREATED"` filter on the update below is the idempotency
 * guard against the webhook (processRazorpayWebhookEvent) processing the
 * same payment concurrently — whichever of the two calls actually flips
 * the status wins; the other becomes a no-op and just returns the
 * already-active subscription.
 */
export const verifyRazorpayPayment = async (userId, { razorpay_order_id, razorpay_payment_id, razorpay_signature } = {}) => {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(400, "Missing payment verification fields");
  }

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, userId });
  if (!payment) throw new ApiError(404, "Order not found for this user");

  if (payment.status === "PAID") {
    return UserSubscription.findOne({ userId }).populate("planId");
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (!safeCompare(expectedSignature, razorpay_signature)) {
    payment.status = "FAILED";
    payment.failureReason = "Signature mismatch";
    await payment.save();
    throw new ApiError(400, "Payment verification failed");
  }

  // Flipping the Payment to PAID and activating the subscription must
  // succeed or fail together. Without a transaction, a crash between the
  // two writes would leave a payment marked PAID whose subscription never
  // actually activated — and with no retry path, since the idempotency
  // check above short-circuits the instant it sees status "PAID".
  const session = await mongoose.startSession();
  let activatedSub = null;
  try {
    await session.withTransaction(async () => {
      const result = await Payment.updateOne(
        { _id: payment._id, status: "CREATED" },
        {
          status: "PAID",
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          verifiedVia: "CLIENT",
        },
        { session }
      );

      if (result.modifiedCount === 1) {
        const updatedPayment = await Payment.findById(payment._id).session(session);
        activatedSub = await upgradeUserPlanWithPayment(userId, payment.planId, updatedPayment, { session });
      }
    });
  } finally {
    await session.endSession();
  }

  if (activatedSub) return activatedSub;

  // Lost the race to the webhook — the plan is (or is about to be) active
  // either way, so this is still a success from the caller's perspective.
  return UserSubscription.findOne({ userId }).populate("planId");
};

/**
 * Handles a Razorpay webhook delivery. `rawBody` must be the exact raw
 * request bytes (a Buffer) — HMAC verification fails silently-but-wrongly
 * against a re-serialized JSON string, since key order/whitespace aren't
 * guaranteed to round-trip identically.
 *
 * Verified against RAZORPAY_WEBHOOK_SECRET — a DIFFERENT secret than
 * RAZORPAY_KEY_SECRET (used for the client-verify path above), configured
 * separately in the Razorpay dashboard's webhook settings. Mixing these two
 * secrets up is a common integration mistake.
 */
export const processRazorpayWebhookEvent = async (rawBody, signatureHeader) => {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new ApiError(500, "Razorpay webhook secret is not configured");
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (!safeCompare(expectedSignature, signatureHeader)) {
    throw new ApiError(400, "Invalid webhook signature");
  }

  const event = JSON.parse(rawBody.toString("utf8"));

  if (event.event === "payment.captured") {
    const paymentEntity = event.payload?.payment?.entity;
    if (!paymentEntity?.order_id) return { handled: false };

    const payment = await Payment.findOne({ razorpayOrderId: paymentEntity.order_id });
    if (!payment) return { handled: false }; // unknown order — nothing to reconcile

    if (payment.status !== "PAID") {
      // Same crash-safety reasoning as verifyRazorpayPayment above — the
      // status flip and the subscription activation must be atomic.
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const result = await Payment.updateOne(
            { _id: payment._id, status: "CREATED" },
            { status: "PAID", razorpayPaymentId: paymentEntity.id, verifiedVia: "WEBHOOK" },
            { session }
          );
          if (result.modifiedCount === 1) {
            const updatedPayment = await Payment.findById(payment._id).session(session);
            await upgradeUserPlanWithPayment(payment.userId, payment.planId, updatedPayment, { session });
          }
        });
      } finally {
        await session.endSession();
      }
    }
    return { handled: true };
  }

  if (event.event === "payment.failed") {
    const paymentEntity = event.payload?.payment?.entity;
    if (paymentEntity?.order_id) {
      await Payment.updateOne(
        { razorpayOrderId: paymentEntity.order_id, status: "CREATED" },
        { status: "FAILED", failureReason: paymentEntity.error_description || "Payment failed" }
      );
    }
    return { handled: true };
  }

  return { handled: false };
};
