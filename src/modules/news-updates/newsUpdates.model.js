import mongoose from "mongoose";

const newsUpdatesSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    priority: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW"],
      default: "MEDIUM",
    },

    color: {
      type: String,
      enum: [
        "blue",
        "green",
        "red",
        "orange",
        "purple",
        "yellow",
      ],
      default: "blue",
    },

    visibleFrom: {
      type: Date,
      required: true,
    },

    visibleTill: {
      type: Date,
      required: true,
    },

    audience: {
      type: String,
      enum: [
        "ALL",
        "ORGANIZATION",
        "ASSIGNED_TEST",
      ],
      default: "ALL",
    },

    organizations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Organization",
      },
    ],

    assignedTests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Test",
      },
    ],

    pinned: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      role: {
        type: String,
        required: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
newsUpdatesSchema.index({ visibleFrom: 1 });
newsUpdatesSchema.index({ visibleTill: 1 });
newsUpdatesSchema.index({ audience: 1 });
newsUpdatesSchema.index({ priority: 1 });
newsUpdatesSchema.index({ isActive: 1 });

export default mongoose.model("NewsUpdate", newsUpdatesSchema);