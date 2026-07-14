import mongoose from "mongoose";

const userSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // Only one active subscription per user at a time
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "CANCELLED", "EXPIRED", "PAST_DUE"],
      default: "ACTIVE",
    },
    startsAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date, // null if lifetime/free
      default: null,
    },
    paymentId: {
      type: String, // Stripe/Razorpay reference
    },
    autoRenew: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model("UserSubscription", userSubscriptionSchema);
