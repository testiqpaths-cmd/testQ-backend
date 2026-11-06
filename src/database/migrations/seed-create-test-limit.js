/**
 * One-off, idempotent migration for feature-wise usage limits.
 *
 * Configures metered consumption features (CREATE_TEST, AI_INTERVIEW) as type="USAGE",
 * while preserving permission/toggle features (DASHBOARD, COMPANY_WISE_TEST, etc.)
 * as type="BOOLEAN".
 *
 * Sets the default Free Student plan's CREATE_TEST limit to 5 lifetime uses.
 *
 * Usage:
 *   node src/database/migrations/seed-create-test-limit.js
 */
import crypto from "crypto";
if (!globalThis.crypto) globalThis.crypto = crypto;
import mongoose from "mongoose";
import env from "../../config/env.js";
import Role from "../../modules/subscription/models/Role.model.js";
import Plan from "../../modules/subscription/models/Plan.model.js";
import Feature from "../../modules/subscription/models/Feature.model.js";
import PlanFeature from "../../modules/subscription/models/PlanFeature.model.js";

async function run() {
  const uri = env.MONGO_URI.includes("testportal")
    ? env.MONGO_URI
    : env.MONGO_URI.replace(/\/?(\?.*)?$/, "/testportal$1");

  console.log("Connecting to:", uri);
  await mongoose.connect(uri);
  console.log("Connected to database:", mongoose.connection.name);

  // 1. Configure CREATE_TEST as USAGE feature
  const createTestFeature = await Feature.findOneAndUpdate(
    { key: "CREATE_TEST" },
    {
      key: "CREATE_TEST",
      displayName: "Create Custom Mock Tests",
      description: "Create custom mock tests for practice",
      category: "Exam",
      type: "USAGE",
      active: true,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log("CREATE_TEST configured as:", createTestFeature.type);

  // 2. Configure AI_INTERVIEW as USAGE feature
  const aiInterviewFeature = await Feature.findOneAndUpdate(
    { key: "AI_INTERVIEW" },
    {
      $set: {
        type: "USAGE",
        active: true,
      },
    },
    { new: true }
  );
  if (aiInterviewFeature) {
    console.log("AI_INTERVIEW configured as:", aiInterviewFeature.type);
  }

  // 3. Find STUDENT role
  const studentRole = await Role.findOne({ name: "STUDENT" });
  if (!studentRole) {
    console.error("STUDENT role not found!");
    await mongoose.disconnect();
    return;
  }

  // 4. Update default Free Student plan: CREATE_TEST limit = 5
  const freeStudentPlan = await Plan.findOne({
    roleId: studentRole._id,
    isDefault: true,
  });

  if (freeStudentPlan) {
    const pf = await PlanFeature.findOneAndUpdate(
      { planId: freeStudentPlan._id, featureId: createTestFeature._id },
      {
        enabled: true,
        limit: 5,
        resetType: "LIFETIME",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(
      `Free Student Plan (${freeStudentPlan.name}) -> CREATE_TEST: enabled=${pf.enabled}, limit=${pf.limit}, resetType=${pf.resetType}`
    );
  } else {
    console.warn("No default Free Student plan found.");
  }

  // 5. Verify Plus plan mapping
  const plusPlan = await Plan.findOne({
    roleId: studentRole._id,
    isDefault: false,
    name: /plus/i,
  });

  if (plusPlan) {
    const pfPlus = await PlanFeature.findOne({
      planId: plusPlan._id,
      featureId: createTestFeature._id,
    });
    console.log(
      `Plus Plan (${plusPlan.name}) -> CREATE_TEST: enabled=${pfPlus?.enabled}, limit=${pfPlus?.limit}, resetType=${pfPlus?.resetType}`
    );
  }

  await mongoose.disconnect();
  console.log("Migration completed successfully.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
