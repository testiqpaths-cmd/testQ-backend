import mongoose from "mongoose";
import crypto from "crypto";
import Role from "../models/Role.model.js";
import Feature from "../models/Feature.model.js";
import Plan from "../models/Plan.model.js";
import PlanFeature from "../models/PlanFeature.model.js";
import UserSubscription from "../models/UserSubscription.model.js";
import UserFeatureUsage from "../models/UserFeatureUsage.model.js";
import FeatureReservation from "../models/FeatureReservation.model.js";
import Payment from "../models/Payment.model.js";
import User from "../../../modules/auth/models/User.model.js"; // Existing user model
import Organization from "../../../models/organization.model.js";
import { ApiError } from "../../../common/exceptions/ApiError.js";
import { getRazorpayClient } from "./razorpay.client.js";
import env from "../../../config/env.js";
import logger from "../../../config/logger.js";

/**
 * Executes a callback within a MongoDB multi-document ACID transaction.
 * Gracefully falls back if running on a standalone instance without replica sets.
 */
export const withSubscriptionTransaction = async (workFn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await workFn(session);
    });
    return result;
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("Transaction numbers are only allowed on a replica set") ||
        err.message.includes("replica set"))
    ) {
      return await workFn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;

const isPastExpiry = (sub) => Boolean(sub?.expiresAt && sub.expiresAt <= new Date());

/**
 * The login account that owns an organization's subscription. Students and
 * the org account both point at the same Organization document via
 * user.organizationId; the org's plan is stored on that ORGANIZATION user
 * (the oldest one, should an organization ever have more than one login).
 */
export const getOrganizationAccount = async (organizationId) => {
  if (!organizationId) return null;
  // Legacy accounts may share the Organization document's _id instead of
  // pointing at it through organizationId.
  return User.findOne({
    role: "ORGANIZATION",
    $or: [{ organizationId }, { _id: organizationId }],
  })
    .sort({ createdAt: 1 })
    .select("_id role organizationId status")
    .lean();
};

/**
 * Gets the subscription that governs `userId` (an independent STUDENT or an
 * ORGANIZATION account), assigning that role's default plan when the user
 * has none or their plan is no longer usable (expired / cancelled).
 *
 * Returns:
 *  - an ACTIVE subscription, or
 *  - the user's non-active subscription when there's no default plan to fall
 *    back to (callers treat it as "subscription expired / required"), or
 *  - null when the user has never had a subscription and their role has no
 *    default plan. For ORGANIZATION accounts that means "plans aren't set up
 *    for organizations yet" and they keep legacy unrestricted access.
 *
 * Org-affiliated students never own a subscription — they're governed by
 * their organization's plan; see resolveAccessPolicy(). IQPATH_ADMIN is
 * unrestricted. Both return null here.
 */
export const getUserSubscription = async (userId) => {
  const user = await User.findById(userId).select("role organizationId");
  if (!user) throw new ApiError(404, "User not found");

  const isOrgAffiliatedStudent = user.role === "STUDENT" && Boolean(user.organizationId);
  if (isOrgAffiliatedStudent || !["STUDENT", "ORGANIZATION"].includes(user.role)) {
    return null;
  }

  // One subscription document per user (unique userId), whatever its status.
  let sub = await UserSubscription.findOne({ userId }).populate("planId");
  if (sub && sub.status === "ACTIVE" && sub.planId && !isPastExpiry(sub)) {
    return sub;
  }

  const roleDoc = await Role.findOne({ name: user.role.toUpperCase() });
  const defaultPlan = roleDoc
    ? await Plan.findOne({ roleId: roleDoc._id, isDefault: true, active: { $ne: false } })
    : null;

  if (!defaultPlan) {
    if (!roleDoc) {
      logger.warn(`[SubscriptionService] User ${userId} has unknown role: ${user.role}`);
    } else if (!sub) {
      logger.debug?.(`[SubscriptionService] No default plan for role: ${roleDoc.name}`);
    }
    return sub || null;
  }

  // Missing, expired or cancelled plan -> fall back to the role's default
  // plan. Usage counters are kept, so the default plan's limits apply to
  // what was already consumed.
  const defaultExpiry = defaultPlan.durationDays
    ? new Date(Date.now() + defaultPlan.durationDays * DAY_MS)
    : null;

  if (sub) {
    sub.planId = defaultPlan._id;
    sub.status = "ACTIVE";
    sub.startsAt = new Date();
    sub.expiresAt = defaultExpiry;
    await sub.save();
  } else {
    try {
      sub = await UserSubscription.create({
        userId: user._id,
        planId: defaultPlan._id,
        status: "ACTIVE",
        expiresAt: defaultExpiry,
      });
    } catch (err) {
      // Concurrent first request created it already.
      if (err.code !== 11000) throw err;
    }
  }

  return UserSubscription.findOne({ userId }).populate("planId");
};

/**
 * Decides which plan (if any) governs a user and which allowance applies.
 *
 *   { mode: "BYPASS" }  — unrestricted (admins; organizations — and their
 *                         students — while no organization plan exists)
 *   { mode: "PLAN", sub, scope, user }
 *       scope "SELF"        — independent student or organization account:
 *                             PlanFeature.enabled/limit/resetType
 *       scope "ORG_STUDENT" — student of an organization: the org's plan,
 *                             PlanFeature.studentEnabled/studentLimit/
 *                             studentResetType, counted per student
 *   { mode: "NONE", user } — independent student with no subscription
 */
export const resolveAccessPolicy = async (userOrId) => {
  const user =
    userOrId && userOrId.role
      ? userOrId
      : await User.findById(userOrId).select("role organizationId status");
  if (!user || user.status === "SUSPENDED") {
    throw new ApiError(403, "Account suspended or not found.");
  }

  if (user.role === "IQPATH_ADMIN") return { mode: "BYPASS", user };

  if (user.role === "STUDENT" && user.organizationId) {
    const orgAccount = await getOrganizationAccount(user.organizationId);
    if (!orgAccount) return { mode: "BYPASS", user };
    const sub = await getUserSubscription(orgAccount._id);
    if (!sub) return { mode: "BYPASS", user };
    return { mode: "PLAN", sub, scope: "ORG_STUDENT", user };
  }

  if (user.role === "ORGANIZATION") {
    const sub = await getUserSubscription(user._id);
    if (!sub) return { mode: "BYPASS", user };
    return { mode: "PLAN", sub, scope: "SELF", user };
  }

  if (user.role === "STUDENT") {
    const sub = await getUserSubscription(user._id);
    if (!sub) return { mode: "NONE", user };
    return { mode: "PLAN", sub, scope: "SELF", user };
  }

  return { mode: "BYPASS", user };
};

/** The allowance a PlanFeature grants for a given policy scope. */
export const getFeatureRule = (planFeature, scope) => {
  if (!planFeature) return null;
  if (scope === "ORG_STUDENT") {
    return {
      enabled: Boolean(planFeature.studentEnabled),
      limit: planFeature.studentLimit ?? null,
      resetType: planFeature.studentResetType || "LIFETIME",
    };
  }
  return {
    enabled: Boolean(planFeature.enabled),
    limit: planFeature.limit ?? null,
    resetType: planFeature.resetType || "LIFETIME",
  };
};

/**
 * The Organization document an ORGANIZATION account manages: normally
 * user.organizationId; older accounts were created sharing its _id.
 */
const getManagedOrganizationId = (orgUser) => orgUser?.organizationId || orgUser?._id || null;

/** Active students of the given Organization document. */
const countOrganizationStudents = (organizationId) =>
  organizationId
    ? User.countDocuments({ organizationId, role: "STUDENT", status: "ACTIVE" })
    : Promise.resolve(0);

/**
 * Single source of truth for "does this user have paid access" — shared by
 * the cross-app SSO verify endpoint (resume builder) and any future internal
 * gate, so both apply the exact same rule. Deliberately returns the plan
 * name/expiry alongside the boolean since callers that need to reject also
 * want to explain why (e.g. "renew your plan" vs "you're not logged in").
 *
 * Org accounts and their students follow the organization's plan (students
 * via its per-student allowance); until organization plans exist they keep
 * legacy full access — see resolveAccessPolicy().
 */
export const getPaidAccessStatus = async (userId) => {
  const user = await User.findById(userId).select("role organizationId status");
  if (!user || user.status === "SUSPENDED") {
    return { hasActivePaidAccess: false, planName: null, subscriptionExpiresAt: null };
  }

  const policy = await resolveAccessPolicy(user);
  // Organizations (and their students) with no organization plan set up yet
  // keep the legacy "an org seat is a paid seat" access.
  if (policy.mode === "BYPASS") {
    const isOrgSide = user.role === "ORGANIZATION" || Boolean(user.organizationId);
    return { hasActivePaidAccess: true, planName: isOrgSide ? "Organization" : null, subscriptionExpiresAt: null };
  }

  const { sub } = policy;
  if (policy.mode === "NONE" || !sub || sub.status !== "ACTIVE" || !sub.planId) {
    return { hasActivePaidAccess: false, planName: sub?.planId?.name ?? null, subscriptionExpiresAt: sub?.expiresAt ?? null };
  }
  if (isPastExpiry(sub)) {
    return { hasActivePaidAccess: false, planName: sub.planId?.name, subscriptionExpiresAt: sub.expiresAt };
  }

  // Access is governed purely by the RESUME_BUILDER PlanFeature toggle
  // (Subscriptions > Plans > Features in the admin panel) — an admin can
  // grant it to any plan, including the free tier, or revoke it from a paid
  // one. For an organization's students it's the plan's per-student toggle.
  // Fails CLOSED if the feature or its plan mapping doesn't exist — this
  // gate protects paid content, so "not configured" must mean "no access".
  const feature = await Feature.findOne({ key: "RESUME_BUILDER", active: true });
  let resumeBuilderEnabled = false;
  if (feature) {
    const planFeature = await PlanFeature.findOne({ planId: sub.planId._id, featureId: feature._id });
    resumeBuilderEnabled = Boolean(getFeatureRule(planFeature, policy.scope)?.enabled);
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

  // Independent students buy STUDENT plans, organization accounts buy
  // ORGANIZATION plans. Org students are governed by their org's plan.
  if (user.role === "STUDENT" && user.organizationId) {
    throw new ApiError(
      403,
      "Your plan is managed by your organization. Please contact your organization to upgrade."
    );
  }
  if (!["STUDENT", "ORGANIZATION"].includes(user.role)) {
    throw new ApiError(403, "Only students and organizations can subscribe to plans.");
  }

  const plan = await Plan.findById(planId).populate("roleId");
  if (!plan || !plan.active) {
    throw new ApiError(404, "Plan not found or inactive");
  }

  if (plan.roleId?.name !== user.role) {
    throw new ApiError(
      403,
      user.role === "ORGANIZATION"
        ? "This plan is not available for organizations."
        : "This plan is not available for students."
    );
  }

  return { user, plan };
};

/**
 * Organization.studentLimit — the per-organization student cap set at
 * creation time. Only enforced here for organizations without a plan
 * (user.service.js also enforces it when students are created).
 */
const assertLegacyStudentLimit = async (organizationId, incrementBy, featureKey) => {
  if (!organizationId) return;
  const org = await Organization.findById(organizationId).select("studentLimit name").lean();
  if (!org || org.studentLimit === null || org.studentLimit === undefined) return;
  const currentCount = await countOrganizationStudents(organizationId);
  if (currentCount + incrementBy > org.studentLimit) {
    throw new ApiError(
      402,
      `Student limit reached for ${org.name || "this organization"}. You can add at most ${Math.max(
        0,
        org.studentLimit - currentCount
      )} more student(s) (limit: ${org.studentLimit}).`,
      null,
      "FEATURE_LIMIT_REACHED",
      {
        feature: featureKey,
        used: currentCount,
        limit: org.studentLimit,
        remaining: Math.max(0, org.studentLimit - currentCount),
        availablePlans: true,
      }
    );
  }
};

/**
 * Checks if a user has access to a specific feature.
 * For USAGE features, incrementBy will increment the usage record (default 0).
 * For CAPACITY features, incrementBy represents the new items being added, ensuring currentCount + incrementBy <= limit.
 */
export const checkFeatureAccess = async (
  userId,
  featureKey,
  incrementBy = 0,
  reservationId = null,
  options = {}
) => {
  // 0. Validate incrementBy parameter
  if (typeof incrementBy !== "number" || isNaN(incrementBy) || incrementBy < 0) {
    throw new ApiError(400, "incrementBy must be a non-negative number.");
  }

  // 1. Resolve Feature (FAIL-CLOSED: unconfigured / unrecognized feature throws 402)
  const feature = await Feature.findOne({ key: featureKey, active: true });
  if (!feature) {
    throw new ApiError(
      402,
      `Feature '${featureKey}' is not configured or recognized.`,
      null,
      "FEATURE_NOT_INCLUDED",
      { feature: featureKey, availablePlans: true }
    );
  }

  // 2. Resolve which plan governs this user (own plan, the organization's
  // plan for org students, or unrestricted)
  const policy = await resolveAccessPolicy(userId);
  const { user } = policy;

  if (policy.mode === "BYPASS") {
    // Legacy organization student cap (Organization.studentLimit) still
    // applies to organizations that have no plan yet.
    if (user.role === "ORGANIZATION" && feature.key === "MAX_STUDENTS") {
      await assertLegacyStudentLimit(getManagedOrganizationId(user), incrementBy, feature.key);
    }
    return true;
  }

  const isOrgStudent = policy.scope === "ORG_STUDENT";
  const planLabel = isOrgStudent ? "your organization's plan" : "your current plan";
  // Lets the client tell org students to contact their organization instead
  // of showing them a purchase page they can't use.
  const managedBy = isOrgStudent ? "ORGANIZATION" : null;
  const denial = (message, code, extra = {}) =>
    new ApiError(402, message, null, code, {
      feature: feature.key,
      availablePlans: !isOrgStudent,
      managedBy,
      ...extra,
    });

  // 3. Subscription must exist, be active and not past its expiry
  const { sub } = policy;
  if (policy.mode === "NONE" || !sub || !sub.planId) {
    throw denial(
      isOrgStudent
        ? "Your organization has no active plan. Please contact your organization."
        : "No active subscription found. Please subscribe to access this feature.",
      "SUBSCRIPTION_REQUIRED"
    );
  }

  if (sub.status !== "ACTIVE" || isPastExpiry(sub)) {
    if (sub.status === "ACTIVE") {
      sub.status = "EXPIRED";
      await sub.save();
    }
    throw denial(
      isOrgStudent
        ? "Your organization's plan has expired. Please contact your organization."
        : "Your subscription has expired. Please renew or upgrade to continue.",
      "SUBSCRIPTION_EXPIRED"
    );
  }

  const planId = sub.planId._id ? sub.planId._id : sub.planId;

  // 4. Resolve Plan Feature Config (FAIL-CLOSED)
  const planFeature = await PlanFeature.findOne({ planId, featureId: feature._id });
  const rule = getFeatureRule(planFeature, policy.scope);

  if (!rule) {
    throw denial(
      `Access to ${feature.displayName} is not included in ${planLabel}.`,
      "FEATURE_NOT_INCLUDED",
      { used: 0, limit: 0, remaining: 0 }
    );
  }

  if (!rule.enabled) {
    throw denial(
      `Access to ${feature.displayName} is disabled on ${planLabel}.`,
      "FEATURE_NOT_INCLUDED",
      { used: 0, limit: 0, remaining: 0 }
    );
  }

  const limit = rule.limit;
  if (limit === null) {
    return true; // Unlimited
  }

  if (limit === 0) {
    throw denial(
      `Access to ${feature.displayName} is not available in ${planLabel}.`,
      "FEATURE_LIMIT_REACHED",
      { used: 0, limit: 0, remaining: 0 }
    );
  }

  // 5. Handle based on feature type
  if (feature.type === "BOOLEAN") {
    return true;
  }

  if (feature.type === "CAPACITY") {
    let currentCount = 0;
    if (feature.key === "MAX_STUDENTS" && user.role === "ORGANIZATION") {
      currentCount = await countOrganizationStudents(getManagedOrganizationId(user));
    }

    if (currentCount + incrementBy > limit) {
      throw denial(
        `Limit exceeded! You can only add ${Math.max(0, limit - currentCount)} more ${feature.displayName} on ${planLabel}. Please upgrade to continue.`,
        "FEATURE_LIMIT_REACHED",
        { used: currentCount, limit, remaining: Math.max(0, limit - currentCount) }
      );
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
      { upsert: true, new: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  } catch (err) {
    // In rare race where unique index collides before upsert commits, retrieve existing doc
    if (err.code === 11000) {
      usageRecord = await UserFeatureUsage.findOne({ userId, featureId: feature._id });
    } else {
      throw err;
    }
  }

  if (!usageRecord) {
    usageRecord = await UserFeatureUsage.findOne({ userId, featureId: feature._id });
  }

  if (!usageRecord) {
    throw new ApiError(500, "Unable to resolve feature usage counter. Please try again.");
  }

  const now = new Date();
  const neededReset = (usageRecord.periodEnd && now >= usageRecord.periodEnd) || !usageRecord.periodEnd;
  if (neededReset) {
    await handleResetLogic(usageRecord, rule.resetType);
    await usageRecord.save();
  }

  // If incrementBy === 0, just check access without consuming usage.
  // options.skipLimitCheck: only verify the plan includes the feature, don't
  // require remaining quota. Used to gate access to things the user already
  // created (e.g. an AI interview session that consumed their last slot).
  if (incrementBy === 0) {
    if (!options.skipLimitCheck && usageRecord.usedCount >= limit) {
      throw denial(
        `You have reached the maximum limit (${limit}) for ${feature.displayName} on ${planLabel}.${isOrgStudent ? " Please contact your organization." : " Please upgrade to continue."}`,
        "FEATURE_LIMIT_REACHED",
        { used: usageRecord.usedCount, limit, remaining: 0 }
      );
    }
    return true;
  }

  // Atomic conditional increment: guarantees concurrency safety at the database level
  const updateOp = {
    $inc: { usedCount: incrementBy },
    $set: { lastUsedAt: new Date() },
  };

  if (reservationId) {
    // Retain in embedded array as lightweight backward-compatible record
    updateOp.$push = {
      reservations: {
        $each: [
          {
            reservationId,
            count: incrementBy,
            status: "ACTIVE",
            createdAt: new Date(),
          },
        ],
        $slice: -200,
      },
    };
  }

  // 4. If reservationId is present, execute atomic usage increment and FeatureReservation creation inside an ACID transaction
  if (reservationId) {
    const leaseMs = options.leaseMs || 15 * 60 * 1000;
    await withSubscriptionTransaction(async (session) => {
      const sessionOpt = session ? { session } : {};
      const updated = await UserFeatureUsage.findOneAndUpdate(
        {
          _id: usageRecord._id,
          usedCount: { $lte: limit - incrementBy },
        },
        updateOp,
        { new: true, returnDocument: "after", ...sessionOpt }
      );

      if (!updated) {
        throw denial(
        `You have reached the maximum limit (${limit}) for ${feature.displayName} on ${planLabel}.${isOrgStudent ? " Please contact your organization." : " Please upgrade to continue."}`,
        "FEATURE_LIMIT_REACHED",
        { used: usageRecord.usedCount, limit, remaining: Math.max(0, limit - usageRecord.usedCount) }
      );
      }

      await FeatureReservation.create(
        [
          {
            reservationId,
            userId,
            featureId: feature._id,
            featureKey: feature.key,
            count: incrementBy,
            status: "PENDING",
            leaseExpiresAt: new Date(Date.now() + leaseMs),
            metadata: options.metadata || {},
          },
        ],
        sessionOpt
      );
    });

    return true;
  }

  // Fallback for non-reserved USAGE increment
  const updatedUsage = await UserFeatureUsage.findOneAndUpdate(
    {
      _id: usageRecord._id,
      usedCount: { $lte: limit - incrementBy },
    },
    updateOp,
    { new: true }
  );

  if (!updatedUsage) {
    throw denial(
        `You have reached the maximum limit (${limit}) for ${feature.displayName} on ${planLabel}.${isOrgStudent ? " Please contact your organization." : " Please upgrade to continue."}`,
        "FEATURE_LIMIT_REACHED",
        { used: usageRecord.usedCount, limit, remaining: Math.max(0, limit - usageRecord.usedCount) }
      );
  }

  return true;
};

/**
 * Commits a previously reserved feature usage slot upon confirmed business operation success.
 * Transition: PENDING -> COMMITTED.
 * Guaranteed idempotent against multiple commit calls.
 */
export const commitFeatureUsage = async (
  target,
  targetResourceId = null,
  targetResourceType = null
) => {
  let resId = null;
  if (typeof target === "string") {
    resId = target;
  } else if (target && typeof target === "object" && target.featureReservation) {
    resId = target.featureReservation.reservationId;
  }

  if (!resId) return null;

  const updateFields = {
    status: "COMMITTED",
  };
  if (targetResourceId) updateFields.targetResourceId = targetResourceId;
  if (targetResourceType) updateFields.targetResourceType = targetResourceType;

  const reservation = await FeatureReservation.findOneAndUpdate(
    { reservationId: resId, status: "PENDING" },
    { $set: updateFields },
    { new: true }
  );

  if (reservation) {
    await UserFeatureUsage.updateOne(
      { userId: reservation.userId, featureId: reservation.featureId },
      { $set: { "reservations.$[elem].status": "COMMITTED" } },
      { arrayFilters: [{ "elem.reservationId": resId }] }
    );
  }

  return reservation;
};

/**
 * Safely releases (refunds) a previously reserved feature usage slot if downstream
 * operation fails before completion. Guaranteed idempotent against duplicate refunds.
 * Transition: PENDING -> RELEASED.
 */
export const releaseFeatureUsage = async (
  target,
  featureKey = null,
  count = 1,
  reservationId = null
) => {
  let userId = target;
  let resId = reservationId;
  let targetCount = count;
  let key = featureKey;

  // Request context polymorphism: supports passing `req` directly
  if (target && typeof target === "object" && target.featureReservation) {
    if (target.featureReservation.released) {
      return; // Already released for this request (idempotent in-memory)
    }
    target.featureReservation.released = true;
    userId = target.featureReservation.userId;
    key = key || target.featureReservation.featureKey;
    resId = resId || target.featureReservation.reservationId;
    targetCount = target.featureReservation.count || 1;
  }

  if (!userId || !key || typeof targetCount !== "number" || targetCount <= 0)
    return;

  try {
    const feature = await Feature.findOne({ key: key, active: true });
    if (!feature || feature.type !== "USAGE") return;

    // 1. If reservationId is present, check dedicated FeatureReservation collection first
    if (resId) {
      await withSubscriptionTransaction(async (session) => {
        const sessionOpt = session ? { session } : {};
        const existingRes = await FeatureReservation.findOne({ reservationId: resId }).session(session || null);
        if (existingRes) {
          if (existingRes.status === "PENDING") {
            const updated = await FeatureReservation.findOneAndUpdate(
              { reservationId: resId, status: "PENDING" },
              { $set: { status: "RELEASED" } },
              { new: true, returnDocument: "after", ...sessionOpt }
            );

            if (updated) {
              // Exactly-once decrement of usedCount
              await UserFeatureUsage.findOneAndUpdate(
                {
                  userId,
                  featureId: feature._id,
                  usedCount: { $gte: existingRes.count },
                },
                {
                  $inc: { usedCount: -existingRes.count },
                  $set: { "reservations.$[elem].status": "RELEASED" },
                },
                {
                  arrayFilters: [{ "elem.reservationId": resId }],
                  ...sessionOpt,
                }
              );
            }
          }
          // Found in FeatureReservation collection (PENDING, COMMITTED, RELEASED or EXPIRED).
          // Return immediately to guarantee idempotent state and never fall through to legacy check.
          return;
        }

        // Backward compatibility check for legacy embedded reservation test fixtures
        await UserFeatureUsage.findOneAndUpdate(
          {
            userId,
            featureId: feature._id,
            usedCount: { $gte: targetCount },
            reservations: {
              $elemMatch: { reservationId: resId, status: "ACTIVE" },
            },
          },
          {
            $inc: { usedCount: -targetCount },
            $set: { "reservations.$.status": "RELEASED" },
          },
          { new: true, returnDocument: "after", ...sessionOpt }
        );
      });
      return;
    }

    // 2. Fallback for calls without a specific reservationId
    await UserFeatureUsage.findOneAndUpdate(
      { userId, featureId: feature._id, usedCount: { $gte: targetCount } },
      { $inc: { usedCount: -targetCount } }
    );
  } catch (err) {
    logger.warn(`Failed to release feature usage for ${key}: ${err.message}`);
  }
};

/**
 * Extends the lease for long-running operations (e.g. active AI interviews).
 */
export const extendFeatureLease = async (
  reservationId,
  extensionMs = 15 * 60 * 1000
) => {
  if (!reservationId) return null;
  return FeatureReservation.findOneAndUpdate(
    { reservationId, status: "PENDING" },
    { $set: { leaseExpiresAt: new Date(Date.now() + extensionMs) } },
    { new: true }
  );
};

/**
 * Reconciles stale PENDING reservations whose lease has expired.
 * Verifies business entity creation before deciding to COMMIT or EXPIRE/refund.
 */
export const reconcileStaleReservations = async ({
  batchSize = 50,
  now = new Date(),
} = {}) => {
  const staleDocs = await FeatureReservation.find({
    status: "PENDING",
    leaseExpiresAt: { $lt: now },
  })
    .limit(batchSize)
    .lean();

  const results = {
    processed: 0,
    committed: 0,
    released: 0,
    skipped: 0,
  };

  for (const doc of staleDocs) {
    results.processed++;

    let entityExists = false;
    try {
      if (doc.featureKey === "CREATE_TEST") {
        const Test = (await import("../../../models/test.model.js")).default;
        // 1. Exact correlation ID check
        let test = await Test.findOne({ reservationId: doc.reservationId }).lean();
        if (!test && doc.targetResourceId) {
          test = await Test.findById(doc.targetResourceId).lean();
        }
        if (!test) {
          // Fallback legacy window check
          test = await Test.findOne({
            $or: [
              { "createdBy.userId": doc.userId },
              { createdBy: doc.userId },
            ],
            createdAt: {
              $gte: new Date(new Date(doc.createdAt).getTime() - 15000),
              $lte: new Date(new Date(doc.leaseExpiresAt).getTime() + 60000),
            },
          }).lean();
        }
        if (test) entityExists = true;
      } else if (doc.featureKey === "TEST_SERIES") {
        const TestSeries = (await import("../../../models/testSeries.model.js")).default;
        if (TestSeries) {
          let series = await TestSeries.findOne({ reservationId: doc.reservationId }).lean();
          if (!series && doc.targetResourceId) {
            series = await TestSeries.findById(doc.targetResourceId).lean();
          }
          if (series) entityExists = true;
        }
      } else if (doc.featureKey === "AI_INTERVIEW") {
        const { InterviewSession } = await import(
          "../../ai-interview/schemas/interview-session.schema.js"
        );
        if (InterviewSession) {
          let session = await InterviewSession.findOne({ reservationId: doc.reservationId }).lean();
          if (!session && doc.targetResourceId) {
            session = await InterviewSession.findById(doc.targetResourceId).lean();
          }
          if (session) entityExists = true;
        }
      }
    } catch (checkErr) {
      logger.warn(
        `Verification check failed for reservation ${doc.reservationId}: ${checkErr.message}`
      );
      results.skipped++;
      continue;
    }

    if (entityExists) {
      // Operation actually succeeded before crash! Transition PENDING -> COMMITTED without refund
      const updated = await FeatureReservation.findOneAndUpdate(
        { reservationId: doc.reservationId, status: "PENDING" },
        { $set: { status: "COMMITTED" } }
      );
      if (updated) results.committed++;
    } else {
      // Operation confirmed NOT created. Atomically transition PENDING -> EXPIRED and refund usedCount within ACID transaction
      await withSubscriptionTransaction(async (session) => {
        const sessionOpt = session ? { session } : {};
        const updated = await FeatureReservation.findOneAndUpdate(
          { reservationId: doc.reservationId, status: "PENDING" },
          { $set: { status: "EXPIRED" } },
          { new: true, returnDocument: "after", ...sessionOpt }
        );
        if (updated) {
          await UserFeatureUsage.findOneAndUpdate(
            {
              userId: doc.userId,
              featureId: doc.featureId,
              usedCount: { $gte: doc.count },
            },
            { $inc: { usedCount: -doc.count } },
            sessionOpt
          );
          results.released++;
        }
      });
    }
  }

  return results;
};

/**
 * Mirrors the deny rules of checkFeatureAccess so the client can disable a
 * feature *before* the user hits a 402. Keep the two in sync.
 *   SUBSCRIPTION_EXPIRED — plan's expiresAt has passed
 *   NOT_INCLUDED         — disabled on the plan, or limit is 0
 *   LIMIT_REACHED        — USAGE/CAPACITY quota used up for the period
 */
const getFeatureBlockState = ({ isExpired, enabled, limit, type, used }) => {
  if (isExpired) return { blocked: true, blockReason: "SUBSCRIPTION_EXPIRED" };
  if (!enabled) return { blocked: true, blockReason: "NOT_INCLUDED" };
  if (limit === null || limit === undefined) return { blocked: false, blockReason: null };
  if (limit === 0) return { blocked: true, blockReason: "NOT_INCLUDED" };
  if (type !== "BOOLEAN" && used >= limit) {
    return { blocked: true, blockReason: "LIMIT_REACHED" };
  }
  return { blocked: false, blockReason: null };
};

/**
 * Returns a detailed breakdown of a user's subscription and usage for the dashboard.
 */
export const getUserUsageDetails = async (userId) => {
  const policy = await resolveAccessPolicy(userId);
  if (policy.mode !== "PLAN") return null;

  const { sub, scope, user } = policy;
  if (!sub || !sub.planId) return null;
  const isOrgStudent = scope === "ORG_STUDENT";

  // usageRecords only needs userId (already known) — it doesn't depend on
  // `plan`, so fetch it in parallel instead of after. planFeatures does
  // depend on plan._id, so it still has to wait for that one. Org students
  // are metered on their own counters against the organization's plan.
  const targetPlanId = sub.planId._id ? sub.planId._id : sub.planId;
  const [plan, usageRecords] = await Promise.all([
    Plan.findById(targetPlanId).populate("roleId"),
    UserFeatureUsage.find({ userId }),
  ]);
  if (!plan) return null;
  const planFeatures = await PlanFeature.find({ planId: plan._id }).populate("featureId");

  // Expiry is only flipped to EXPIRED lazily inside checkFeatureAccess, so
  // compute it here too — otherwise the UI would show features as usable
  // that the API is about to reject.
  const isExpired = sub.status !== "ACTIVE" || isPastExpiry(sub);
  const isOrganizationPlan = plan.roleId?.name === "ORGANIZATION";

  const featureDetails = await Promise.all(
    planFeatures.map(async (pf) => {
      const feature = pf.featureId;
      if (!feature) return null;
      // Student capacity is an organization-account concern only.
      if (feature.key === "MAX_STUDENTS" && (!isOrganizationPlan || isOrgStudent)) return null;

      const rule = getFeatureRule(pf, scope);
      const usage = usageRecords.find((u) => u.featureId.toString() === feature._id.toString());

      let usedCount = usage ? usage.usedCount : 0;

      if (feature.type === "CAPACITY") {
        if (feature.key === "MAX_STUDENTS") {
          usedCount = await countOrganizationStudents(getManagedOrganizationId(user));
        }
      } else if (usage) {
         // simulate reset logic just for display
         const simUsage = new UserFeatureUsage(usage);
         await handleResetLogic(simUsage, rule.resetType);
         usedCount = simUsage.usedCount;
      }

      const { blocked, blockReason } = getFeatureBlockState({
        isExpired,
        enabled: rule.enabled,
        limit: rule.limit,
        type: feature.type,
        used: usedCount,
      });

      return {
        key: feature.key,
        displayName: feature.displayName,
        description: feature.description,
        type: feature.type,
        enabled: rule.enabled,
        limit: rule.limit,
        used: usedCount,
        remaining: rule.limit === null ? "Unlimited" : Math.max(0, rule.limit - usedCount),
        resetType: rule.resetType,
        periodEnd: usage ? usage.periodEnd : null,
        blocked,
        blockReason,
        // On an organization's own view: what each of its students gets.
        ...(isOrganizationPlan && !isOrgStudent
          ? {
              studentAllowance: {
                enabled: Boolean(pf.studentEnabled),
                limit: pf.studentLimit ?? null,
                resetType: pf.studentResetType || "LIFETIME",
              },
            }
          : {}),
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
    status: isExpired ? "EXPIRED" : sub.status,
    expiresAt: sub.expiresAt || null,
    isExpired,
    // true for students whose limits come from their organization's plan:
    // they can't purchase, the client tells them to contact the org instead.
    managedByOrganization: isOrgStudent,
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

  // Clear usage when switching plans (optional, but requested for clean start).
  // An organization's students are metered against its plan, so their
  // counters restart along with the organization's.
  const owner = await User.findById(userId).select("role organizationId").session(session);
  const usageOwners = [userId];
  if (owner?.role === "ORGANIZATION") {
    const studentIds = await User.find({ organizationId: getManagedOrganizationId(owner), role: "STUDENT" })
      .distinct("_id")
      .session(session);
    usageOwners.push(...studentIds);
  }
  await UserFeatureUsage.deleteMany({ userId: { $in: usageOwners } }, { session });

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
  sub.razorpayOrderId = paymentDoc.razorpayOrderId || null;
  sub.razorpayPaymentId = paymentDoc.razorpayPaymentId || null;
  await sub.save({ session });
  return sub;
};

/**
 * IQPATH_ADMIN assigns a plan to an independent student or an organization.
 * Paid plans must be settled in CASH (the only offline mode, and the only
 * mode admins can use — students/organizations pay through Razorpay).
 * `amount` defaults to the plan price and may be overridden (e.g. a
 * discount); it's in major units (rupees), stored in paise like Razorpay
 * payments. Free plans are granted without a payment record.
 */
export const assignPlanByAdmin = async ({
  adminId,
  userId,
  planId,
  paymentMode = null,
  amount = undefined,
  note = null,
}) => {
  const target = await User.findById(userId).select("role organizationId status");
  if (!target) throw new ApiError(404, "Target user not found");

  if (target.role === "STUDENT" && target.organizationId) {
    throw new ApiError(
      400,
      "This student belongs to an organization and follows the organization's plan. Assign a plan to the organization instead."
    );
  }
  if (!["STUDENT", "ORGANIZATION"].includes(target.role)) {
    throw new ApiError(400, "Plans can only be assigned to students and organizations.");
  }

  const plan = await Plan.findById(planId).populate("roleId");
  if (!plan || !plan.active) throw new ApiError(404, "Plan not found or inactive");
  if (plan.roleId?.name !== target.role) {
    throw new ApiError(
      400,
      `This is a ${plan.roleId?.name || "different"} plan and can't be assigned to a ${target.role.toLowerCase()}.`
    );
  }

  const isPaidPlan = (plan.price ?? 0) > 0;
  if (paymentMode && paymentMode !== "CASH") {
    throw new ApiError(400, "Admins can only record CASH payments. Online payments go through Razorpay checkout.");
  }
  if (isPaidPlan && paymentMode !== "CASH") {
    throw new ApiError(400, "This is a paid plan — record it with payment mode CASH.");
  }

  if (!isPaidPlan) {
    return upgradeUserPlan(userId, planId);
  }

  const amountMajor = amount === undefined || amount === null || amount === "" ? plan.price : Number(amount);
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    throw new ApiError(400, "Amount must be a non-negative number.");
  }

  return withSubscriptionTransaction(async (session) => {
    const sessionOpt = session ? { session } : {};
    const [payment] = await Payment.create(
      [
        {
          userId,
          planId: plan._id,
          mode: "CASH",
          amount: Math.round(amountMajor * 100),
          currency: plan.currency || "INR",
          status: "PAID",
          verifiedVia: "ADMIN",
          recordedBy: adminId,
          note: note ? String(note).trim().slice(0, 500) : null,
        },
      ],
      sessionOpt
    );
    return upgradeUserPlanWithPayment(userId, plan._id, payment, { session });
  });
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
