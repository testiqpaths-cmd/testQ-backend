import mongoose from "mongoose";

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
    },
    price: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "USD",
    },
    durationDays: {
      type: Number, // null/0 means lifetime or free
      default: null,
    },
    description: {
      type: String,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false, // if true, assigned automatically upon signup for this role
    },
    icon: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Plan", planSchema);
