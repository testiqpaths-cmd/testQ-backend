import mongoose from "mongoose";
import Role from "../../../src/modules/subscription/models/Role.model.js";
import Feature from "../../../src/modules/subscription/models/Feature.model.js";
import Plan from "../../../src/modules/subscription/models/Plan.model.js";
import PlanFeature from "../../../src/modules/subscription/models/PlanFeature.model.js";
import UserSubscription from "../../../src/modules/subscription/models/UserSubscription.model.js";
import UserFeatureUsage from "../../../src/modules/subscription/models/UserFeatureUsage.model.js";
import Payment from "../../../src/modules/subscription/models/Payment.model.js";
import User from "../../../src/modules/auth/models/User.model.js";
import Organization from "../../../src/models/organization.model.js";

let seq = 1;
const nextId = () => seq++;

export const createRoleFixture = async (name = "STUDENT") => {
  let role = await Role.findOne({ name });
  if (!role) {
    role = await Role.create({
      name,
      description: `${name} role for testing`,
    });
  }
  return role;
};

export const createUserFixture = async (overrides = {}) => {
  const id = nextId();
  return User.create({
    firstName: overrides.firstName || `TestUser${id}`,
    lastName: overrides.lastName || "Tester",
    email: overrides.email || `testuser${id}_${Date.now()}@example.com`,
    password: overrides.password || "Password123!",
    role: overrides.role || "STUDENT",
    organizationId: overrides.organizationId || null,
    status: overrides.status || "ACTIVE",
    isProfileComplete: overrides.isProfileComplete ?? true,
    hasSetPassword: overrides.hasSetPassword ?? true,
    ...overrides,
  });
};

export const createOrganizationFixture = async (overrides = {}) => {
  const id = nextId();
  return Organization.create({
    name: overrides.name || `Org ${id}`,
    studentLimit: overrides.studentLimit !== undefined ? overrides.studentLimit : 10,
    ...overrides,
  });
};

export const createFeatureFixture = async (overrides = {}) => {
  const id = nextId();
  const key = overrides.key || `TEST_FEATURE_${id}`;
  return Feature.create({
    key,
    displayName: overrides.displayName || `Test Feature ${id}`,
    description: overrides.description || "Description",
    type: overrides.type || "USAGE",
    active: overrides.active ?? true,
    ...overrides,
  });
};

export const createPlanFixture = async (roleId, overrides = {}) => {
  const id = nextId();
  return Plan.create({
    name: overrides.name || `Test Plan ${id}`,
    roleId,
    price: overrides.price !== undefined ? overrides.price : 99,
    currency: overrides.currency || "INR",
    durationDays: overrides.durationDays !== undefined ? overrides.durationDays : 30,
    active: overrides.active ?? true,
    isDefault: overrides.isDefault ?? false,
    description: overrides.description || "Plan description",
    ...overrides,
  });
};

export const createPlanFeatureFixture = async (planId, featureId, overrides = {}) => {
  return PlanFeature.create({
    planId,
    featureId,
    enabled: overrides.enabled ?? true,
    limit: overrides.limit !== undefined ? overrides.limit : 10,
    resetType: overrides.resetType || "MONTHLY",
    ...overrides,
  });
};

export const createSubscriptionFixture = async (userId, planId, overrides = {}) => {
  return UserSubscription.create({
    userId,
    planId,
    status: overrides.status || "ACTIVE",
    startsAt: overrides.startsAt || new Date(),
    expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : new Date(Date.now() + 30 * 86400000),
    autoRenew: overrides.autoRenew ?? false,
    ...overrides,
  });
};
