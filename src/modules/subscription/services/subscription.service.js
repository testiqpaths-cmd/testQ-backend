import mongoose from "mongoose";
import Role from "../models/Role.model.js";
import Feature from "../models/Feature.model.js";
import Plan from "../models/Plan.model.js";
import PlanFeature from "../models/PlanFeature.model.js";
import UserSubscription from "../models/UserSubscription.model.js";
import UserFeatureUsage from "../models/UserFeatureUsage.model.js";
import User from "../../../modules/auth/models/User.model.js"; // Existing user model
import { ApiError } from "../../../common/exceptions/ApiError.js";

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

  if (!sub) {
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

    sub = new UserSubscription({
      userId: user._id,
      planId: defaultPlan._id,
      status: "ACTIVE",
    });
    await sub.save();
    sub = await UserSubscription.findById(sub._id).populate("planId");
  }

  return sub;
};

/**
 * Ensures feature reset logic is applied based on resetType
 */
const handleResetLogic = async (usageRecord, resetType) => {
  if (resetType === "LIFETIME") return;

  const now = new Date();
  
  if (usageRecord.periodEnd && now > usageRecord.periodEnd) {
    // Reset needed
    usageRecord.usedCount = 0;
    usageRecord.periodStart = now;

    const nextEnd = new Date(now);
    if (resetType === "MONTHLY") nextEnd.setMonth(nextEnd.getMonth() + 1);
    else if (resetType === "YEARLY") nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    else if (resetType === "WEEKLY") nextEnd.setDate(nextEnd.getDate() + 7);
    else if (resetType === "DAILY") nextEnd.setDate(nextEnd.getDate() + 1);
    
    usageRecord.periodEnd = nextEnd;
  } else if (!usageRecord.periodEnd) {
    // Initialize period
    usageRecord.periodStart = now;
    const nextEnd = new Date(now);
    if (resetType === "MONTHLY") nextEnd.setMonth(nextEnd.getMonth() + 1);
    else if (resetType === "YEARLY") nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    else if (resetType === "WEEKLY") nextEnd.setDate(nextEnd.getDate() + 7);
    else if (resetType === "DAILY") nextEnd.setDate(nextEnd.getDate() + 1);
    
    usageRecord.periodEnd = nextEnd;
  }
};

/**
 * Checks if a user has access to a specific feature.
 * For USAGE features, incrementBy will increment the usage record (default 0).
 * For CAPACITY features, incrementBy represents the new items being added, ensuring currentCount + incrementBy <= limit.
 */
export const checkFeatureAccess = async (userId, featureKey, incrementBy = 0) => {
  // 1. Resolve Feature
  const feature = await Feature.findOne({ key: featureKey, active: true });
  if (!feature) return true; // If feature doesn't exist or is inactive, assume it's unmanaged (allow)

  // 2. Resolve Subscription
  const sub = await getUserSubscription(userId);
  if (!sub) return true; // If no sub system configured for user, fallback allow

  const planId = sub.planId._id ? sub.planId._id : sub.planId;

  // 3. Resolve Plan Feature Config
  const planFeature = await PlanFeature.findOne({ planId, featureId: feature._id });
  
  if (!planFeature) return true; // Feature not mapped in plan -> unlimited

  if (!planFeature.enabled) {
    throw new ApiError(402, `Access to ${feature.displayName} is disabled on your current plan.`);
  }

  const limit = planFeature.limit;
  if (limit === null) { // Unlimited
    return true; 
  }

  if (limit === 0) {
    throw new ApiError(402, `Access to ${feature.displayName} is not available in your current plan.`);
  }

  // 4. Handle based on feature type
  if (feature.type === "CAPACITY") {
    let currentCount = 0;
    if (feature.key === "MAX_STUDENTS") {
      currentCount = await User.countDocuments({ organizationId: userId, status: "ACTIVE" });
    }
    // Add other capacity logic here if needed (e.g. MAX_TESTS, MAX_ROOMS)
    
    if (currentCount + incrementBy > limit) {
      throw new ApiError(402, `Limit exceeded! You can only add ${limit - currentCount} more ${feature.displayName} on your current plan. Please upgrade to continue.`);
    }
    // Capacity features do not save usage records
    return true;
  }

  // 5. Handle USAGE / BOOLEAN Features
  let usageRecord = await UserFeatureUsage.findOne({ userId, featureId: feature._id });
  
  if (!usageRecord) {
    usageRecord = new UserFeatureUsage({
      userId,
      featureId: feature._id,
      usedCount: 0,
      lastUsedAt: new Date(),
    });
  }

  await handleResetLogic(usageRecord, planFeature.resetType);

  // Enforce Limit (if we are trying to add/use more)
  if (usageRecord.usedCount + incrementBy > limit) {
    throw new ApiError(402, `You have reached the maximum limit (${limit}) for ${feature.displayName} on your current plan. Please upgrade to continue.`);
  }

  // Increment Usage
  if (incrementBy > 0) {
    usageRecord.usedCount += incrementBy;
    usageRecord.lastUsedAt = new Date();
    await usageRecord.save();
  }

  return true;
};

/**
 * Returns a detailed breakdown of a user's subscription and usage for the dashboard.
 */
export const getUserUsageDetails = async (userId) => {
  const sub = await getUserSubscription(userId);
  if (!sub) return null;

  // usageRecords only needs userId (already known) — it doesn't depend on
  // `plan`, so fetch it in parallel instead of after. planFeatures does
  // depend on plan._id, so it still has to wait for that one.
  const [plan, usageRecords] = await Promise.all([
    Plan.findById(sub.planId._id ? sub.planId._id : sub.planId).populate("roleId"),
    UserFeatureUsage.find({ userId }),
  ]);
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
    },
    status: sub.status,
    features: featureDetails.filter(f => f !== null),
  };
};

/**
 * Simulates upgrading a user's plan.
 */
export const upgradeUserPlan = async (userId, newPlanId) => {
  const plan = await Plan.findById(newPlanId);
  if (!plan) throw new ApiError(404, "Plan not found");

  let sub = await UserSubscription.findOne({ userId });
  if (sub) {
    sub.planId = plan._id;
    sub.status = "ACTIVE";
    sub.startsAt = new Date();
    sub.expiresAt = plan.durationDays ? new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000) : null;
    await sub.save();
  } else {
    sub = new UserSubscription({
      userId,
      planId: plan._id,
      status: "ACTIVE",
      startsAt: new Date(),
      expiresAt: plan.durationDays ? new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000) : null,
    });
    await sub.save();
  }

  // Clear usage when switching plans (optional, but requested for clean start)
  await UserFeatureUsage.deleteMany({ userId });

  return sub;
};
