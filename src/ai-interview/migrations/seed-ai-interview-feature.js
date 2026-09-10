/**
 * One-off, idempotent seed for the AI_INTERVIEW plan feature.
 *
 * Per the current product decision, AI Interview is wired into the
 * plan/subscription system but NOT actually restricted yet: this seeds the
 * feature enabled (limit: null) on every active plan — STUDENT and
 * ORGANIZATION alike — so featureMiddleware("AI_INTERVIEW") and the
 * frontend <FeatureRoute> pass for everyone. Tighten later by flipping
 * `enabled` on a plan from the admin Features screen (or re-running a
 * narrower seed).
 *
 * Safe to re-run — upserts only its own Feature + PlanFeature rows.
 *
 * Usage:  node src/ai-interview/migrations/seed-ai-interview-feature.js
 */
import mongoose from "mongoose";
import env from "../../config/env.js";
import Plan from "../../modules/subscription/models/Plan.model.js";
import Feature from "../../modules/subscription/models/Feature.model.js";
import PlanFeature from "../../modules/subscription/models/PlanFeature.model.js";

const FEATURE_KEY = "AI_INTERVIEW";

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log("Connected to", mongoose.connection.name);

  const feature = await Feature.findOneAndUpdate(
    { key: FEATURE_KEY },
    {
      key: FEATURE_KEY,
      displayName: "AI Mock Interview",
      description:
        "Adaptive AI-driven mock interviews with scored feedback; organization/admin monitoring dashboard",
      category: "Interview",
      type: "BOOLEAN",
      active: true,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log("Feature ready:", feature.key, feature._id.toString());

  const plans = await Plan.find({ active: true });
  if (!plans.length) {
    console.warn("No active plans found — feature exists but is unmapped (fails open for everyone).");
    await mongoose.disconnect();
    return;
  }

  for (const plan of plans) {
    const pf = await PlanFeature.findOneAndUpdate(
      { planId: plan._id, featureId: feature._id },
      { enabled: true, limit: null, resetType: "LIFETIME" },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Plan "${plan.name}" (${plan._id}) -> AI_INTERVIEW enabled=${pf.enabled}`);
  }

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
