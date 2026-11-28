import mongoose from "mongoose";

const planFeatureSchema = new mongoose.Schema(
  {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    limit: {
      type: Number, // null means unlimited
      default: null,
    },
    resetType: {
      type: String,
      enum: ["LIFETIME", "MONTHLY", "YEARLY", "DAILY", "WEEKLY"],
      default: "LIFETIME",
    },

    // ORGANIZATION plans only: the allowance EACH student of the
    // organization gets for this feature (every student has their own
    // counter). enabled/limit/resetType above apply to the organization
    // account itself. Ignored on STUDENT plans. Fail-closed default: a
    // feature isn't available to org students until the admin enables it.
    studentEnabled: {
      type: Boolean,
      default: false,
    },
    studentLimit: {
      type: Number, // null means unlimited
      default: null,
    },
    studentResetType: {
      type: String,
      enum: ["LIFETIME", "MONTHLY", "YEARLY", "DAILY", "WEEKLY"],
      default: "LIFETIME",
    },
  },
  { timestamps: true }
);

planFeatureSchema.index({ planId: 1, featureId: 1 }, { unique: true });

export default mongoose.model("PlanFeature", planFeatureSchema);
