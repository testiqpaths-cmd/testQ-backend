// src/models/organization.model.js
import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, unique: true }, // short identifier
    address: { type: String },
    contactEmail: { type: String },
    contactPerson: { type: String },
    businessPhone: { type: String },
    // Direct per-organization student cap, set at creation time — independent
    // of the subscription/plan system, which only governs independent
    // (non-organization) students. null/unset means unlimited.
    studentLimit: { type: Number, default: null, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
    // relationships
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const Organization = mongoose.model("Organization", organizationSchema);
export default Organization;
