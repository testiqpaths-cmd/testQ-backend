import mongoose from "mongoose";

const helpSupportSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "resolved"],
      default: "pending",
    },
  },
  { timestamps: true }
);

// Admin/org dashboard counts these by organizationId+status on every load;
// the admin list view sorts by createdAt.
helpSupportSchema.index({ organizationId: 1, status: 1 });
helpSupportSchema.index({ createdAt: -1 });

const HelpSupport = mongoose.model("HelpSupport", helpSupportSchema);

export default HelpSupport;
