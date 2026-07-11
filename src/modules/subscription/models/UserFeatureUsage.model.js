import mongoose from "mongoose";

const userFeatureUsageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
      required: true,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    periodStart: {
      type: Date,
      default: Date.now,
    },
    periodEnd: {
      type: Date, // null if lifetime
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

userFeatureUsageSchema.index({ userId: 1, featureId: 1 }, { unique: true });

export default mongoose.model("UserFeatureUsage", userFeatureUsageSchema);
