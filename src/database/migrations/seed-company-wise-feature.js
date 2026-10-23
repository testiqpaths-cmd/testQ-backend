/**
 * One-off, idempotent seed for the Company-wise Test feature gate.
 *
 * Mirrors exactly what the existing admin subscription API already does
 * (POST /api/subscriptions/admin/features, PUT
 * /api/subscriptions/admin/plans/:planId/features/:featureId — see
 * subscription.controller.js createFeature/updatePlanFeature) — this script
 * is only a stand-in for calling those endpoints as an authenticated
 * IQPATH_ADMIN, using the same upsert semantics, so it's safe to re-run.
 *
 * Does NOT touch any existing Feature/Plan/PlanFeature/Role documents other
 * than the ones it creates/updates for this one feature key. ORGANIZATION
 * and IQPATH_ADMIN plans are intentionally left untouched — checkFeatureAccess
 * already fails open (allows) for any plan with no PlanFeature row mapped to
 * this feature, which is exactly the "unchanged" behavior those roles need.
 *
 * Usage:
 *   node src/database/migrations/seed-company-wise-feature.js
 */
import mongoose from "mongoose";
import env from "../../config/env.js";
import Role from "../../modules/subscription/models/Role.model.js";
import Plan from "../../modules/subscription/models/Plan.model.js";
import Feature from "../../modules/subscription/models/Feature.model.js";
import PlanFeature from "../../modules/subscription/models/PlanFeature.model.js";

const FEATURE_KEY = "COMPANY_WISE_TEST";

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log("Connected to", mongoose.connection.name);

  const feature = await Feature.findOneAndUpdate(
    { key: FEATURE_KEY },
    {
      key: FEATURE_KEY,
      displayName: "Company-wise Test Filtering",
      description: "Filter/create tests and question-bank listings by target company",
      category: "Exam",
      type: "BOOLEAN",
      active: true,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log("Feature ready:", feature.key, feature._id.toString());

  const studentRole = await Role.findOne({ name: "STUDENT" });
  if (!studentRole) {
    console.error("No STUDENT role found — nothing more to do. Feature exists but is unmapped (fails open/allowed for everyone until Plan rows are added).");
    await mongoose.disconnect();
    return;
  }

  const studentPlans = await Plan.find({ roleId: studentRole._id, active: true });
  if (!studentPlans.length) {
    console.warn("No active STUDENT plans found — nothing to map.");
    await mongoose.disconnect();
    return;
  }

  for (const plan of studentPlans) {
    // The default plan is the FREE tier every student gets automatically on
    // signup (see subscription.service.js getUserSubscription) — every other
    // active STUDENT plan is a paid tier.
    const enabled = !plan.isDefault;

    const pf = await PlanFeature.findOneAndUpdate(
      { planId: plan._id, featureId: feature._id },
      { enabled, limit: null, resetType: "LIFETIME" },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(
      `Plan "${plan.name}" (${plan._id}) -> COMPANY_WISE_TEST enabled=${pf.enabled}`
    );
  }

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
