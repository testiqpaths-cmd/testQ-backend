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
  },
  { timestamps: true }
);

planFeatureSchema.index({ planId: 1, featureId: 1 }, { unique: true });

export default mongoose.model("PlanFeature", planFeatureSchema);
