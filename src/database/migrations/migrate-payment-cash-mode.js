/**
 * One-off, idempotent migration for organization plans + CASH payments.
 *
 * 1. Rebuilds Payment.razorpayOrderId's unique index as SPARSE. CASH payments
 *    (recorded by an admin) have no Razorpay order id; with the old
 *    non-sparse unique index the second such payment collides on `null`.
 * 2. Backfills Payment.mode = "RAZORPAY" on existing payments.
 * 3. Reports ORGANIZATION plans, so the admin can check their per-student
 *    allowances before marking one as the default. Org students are blocked
 *    from any feature whose per-student allowance isn't enabled once their
 *    organization is on a plan.
 *
 * Usage:
 *   node src/database/migrations/migrate-payment-cash-mode.js
 */
import crypto from "crypto";
if (!globalThis.crypto) globalThis.crypto = crypto;
import mongoose from "mongoose";
import env from "../../config/env.js";
import Role from "../../modules/subscription/models/Role.model.js";
import Plan from "../../modules/subscription/models/Plan.model.js";
import PlanFeature from "../../modules/subscription/models/PlanFeature.model.js";
import Payment from "../../modules/subscription/models/Payment.model.js";

async function run() {
  const uri = env.MONGO_URI.includes("testportal")
    ? env.MONGO_URI
    : env.MONGO_URI.replace(/\/?(\?.*)?$/, "/testportal$1");

  console.log("Connecting to:", uri);
  await mongoose.connect(uri);
  console.log("Connected to database:", mongoose.connection.name);

  // 1. Sparse unique index on razorpayOrderId
  const collection = Payment.collection;
  const indexes = await collection.indexes();
  const orderIdx = indexes.find((i) => i.key && i.key.razorpayOrderId === 1);
  if (orderIdx && !orderIdx.sparse) {
    console.log(`Dropping non-sparse index ${orderIdx.name}`);
    await collection.dropIndex(orderIdx.name);
  }
  if (!orderIdx || !orderIdx.sparse) {
    await collection.createIndex({ razorpayOrderId: 1 }, { unique: true, sparse: true });
    console.log("Created sparse unique index on razorpayOrderId");
  } else {
    console.log("razorpayOrderId index is already sparse");
  }

  // 2. Backfill mode
  const backfill = await Payment.updateMany(
    { mode: { $exists: false } },
    { $set: { mode: "RAZORPAY" } }
  );
  console.log(`Backfilled mode=RAZORPAY on ${backfill.modifiedCount} payment(s)`);

  // 3. Report organization plans
  const orgRole = await Role.findOne({ name: "ORGANIZATION" });
  if (!orgRole) {
    console.warn("No ORGANIZATION role found — create it before adding organization plans.");
  } else {
    const plans = await Plan.find({ roleId: orgRole._id }).lean();
    if (!plans.length) {
      console.log("No ORGANIZATION plans yet — organizations keep unrestricted access until one is marked default or assigned.");
    }
    for (const plan of plans) {
      const studentEnabled = await PlanFeature.countDocuments({ planId: plan._id, studentEnabled: true });
      console.log(
        `ORG plan "${plan.name}" default=${Boolean(plan.isDefault)} active=${plan.active !== false} ` +
          `features with per-student access enabled: ${studentEnabled}`
      );
    }
  }

  await mongoose.disconnect();
  console.log("Migration completed successfully.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
