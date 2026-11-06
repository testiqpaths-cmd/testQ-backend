import mongoose from "mongoose";

const featureReservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
      required: true,
      index: true,
    },
    featureKey: {
      type: String,
      required: true,
      index: true,
    },
    count: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMMITTED", "RELEASED", "EXPIRED"],
      default: "PENDING",
      index: true,
    },
    targetResourceId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    targetResourceType: {
      type: String,
      default: null,
    },
    leaseExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 15 * 60 * 1000), // 15 mins default lease
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound indexes for high-throughput queries, user status filtering and stale recovery scanning
featureReservationSchema.index({ userId: 1, featureId: 1, status: 1 });
featureReservationSchema.index({ status: 1, leaseExpiresAt: 1 });
featureReservationSchema.index({ featureKey: 1, createdAt: -1 });

export default mongoose.models.FeatureReservation ||
  mongoose.model("FeatureReservation", featureReservationSchema);

