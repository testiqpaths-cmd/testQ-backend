import mongoose from "mongoose";

// One document per checkout ATTEMPT (created at order-creation time, before
// payment happens) — a real audit trail, not just the latest successful
// payment. UserSubscription.lastPaymentId points at whichever of these
// actually succeeded.
const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },

    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
    },
    // Deliberately NO `default: null` here — a sparse index only excludes
    // documents where the field is truly ABSENT, not documents where it's
    // explicitly set to null. With a default, every CREATED/FAILED payment
    // (there can be many, e.g. abandoned checkouts) would carry an explicit
    // `razorpayPaymentId: null`, and the second one ever created would
    // collide on the unique index. Leaving the field unset until a real
    // payment id exists is what makes "sparse" actually work as intended.
    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },

    amount: {
      type: Number, // smallest currency unit (paise/cents) sent to Razorpay
      required: true,
    },
    currency: {
      type: String, // copied from plan.currency at order-creation time
      required: true,
    },

    status: {
      type: String,
      enum: ["CREATED", "PAID", "FAILED"],
      default: "CREATED",
    },
    failureReason: {
      type: String,
      default: null,
    },
    // Which path first flipped this to PAID — the client-side verify call
    // or the async webhook (whichever wins the idempotent update race).
    verifiedVia: {
      type: String,
      enum: ["CLIENT", "WEBHOOK", null],
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);
