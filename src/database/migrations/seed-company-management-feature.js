/**
 * One-off, idempotent seed for the Company Management feature gate — the
 * permission behind creating/editing/deleting Target Companies (as opposed
 * to COMPANY_WISE_TEST, which governs *selecting* companies when building a
 * test). Mirrors seed-company-wise-feature.js exactly.
 *
 * Managing companies is an org/admin capability, not a student one:
 * explicitly disabled on every STUDENT plan, explicitly enabled on every
 * active ORGANIZATION plan. IQPATH_ADMIN is left unmapped — checkFeatureAccess
 * fails open (allows) for any plan with no PlanFeature row, which is exactly
 * the "always allowed" behavior admins need.
 *
 * Usage:
 *   node src/database/migrations/seed-company-management-feature.js
 */
import mongoose from "mongoose";
import env from "../../config/env.js";
import Role from "../../modules/subscription/models/Role.model.js";
import Plan from "../../modules/subscription/models/Plan.model.js";
import Feature from "../../modules/subscription/models/Feature.model.js";
import PlanFeature from "../../modules/subscription/models/PlanFeature.model.js";

const FEATURE_KEY = "COMPANY_MANAGEMENT";

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log("Connected to", mongoose.connection.name);

  const feature = await Feature.findOneAndUpdate(
    { key: FEATURE_KEY },
    {
      key: FEATURE_KEY,
      displayName: "Target Company Management",
      description: "Create, edit, deactivate, and delete the master list of Target Companies",
      category: "Exam",
      type: "BOOLEAN",
      active: true,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log("Feature ready:", feature.key, feature._id.toString());

  const roles = await Role.find({ name: { $in: ["STUDENT", "ORGANIZATION"] } });
  const studentRole = roles.find((r) => r.name === "STUDENT");
  const organizationRole = roles.find((r) => r.name === "ORGANIZATION");

  if (studentRole) {
    const studentPlans = await Plan.find({ roleId: studentRole._id, active: true });
    for (const plan of studentPlans) {
      const pf = await PlanFeature.findOneAndUpdate(
        { planId: plan._id, featureId: feature._id },
        { enabled: false, limit: null, resetType: "LIFETIME" },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`Plan "${plan.name}" (STUDENT) -> COMPANY_MANAGEMENT enabled=${pf.enabled}`);
    }
  } else {
    console.warn("No STUDENT role found — skipping student plan mapping.");
  }

  if (organizationRole) {
    const orgPlans = await Plan.find({ roleId: organizationRole._id, active: true });
    for (const plan of orgPlans) {
      const pf = await PlanFeature.findOneAndUpdate(
        { planId: plan._id, featureId: feature._id },
        { enabled: true, limit: null, resetType: "LIFETIME" },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`Plan "${plan.name}" (ORGANIZATION) -> COMPANY_MANAGEMENT enabled=${pf.enabled}`);
    }
  } else {
    console.warn("No ORGANIZATION role found — skipping organization plan mapping.");
  }

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
