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
        "#000000",
        "#434343",
        "#666666",
        "#999999",
        "#B7B7B7",

        "#980000",
        "#FF0000",
        "#FF9900",
        "#FFFF00",
        "#00FF00",
        "#00FFFF",
        "#4A86E8",
        "#0000FF",
        "#9900FF",
        "#FF00FF",

        "#EA9999",
        "#F9CB9C",
        "#FFE599",
        "#B6D7A8",
        "#A2C4C9",
        "#A4C2F4",
        "#B4A7D6",
        "#D5A6BD",

        "#E06666",
        "#F6B26B",
        "#FFD966",
        "#93C47D",
        "#76A5AF",
        "#6D9EEB",
        "#8E7CC3",
        "#C27BA0",

        "#CC4125",
        "#E69138",
        "#F1C232",
        "#6AA84F",
        "#45818E",
        "#3C78D8",
        "#674EA7",
        "#A64D79",

        "#A61C00",
        "#B45F06",
        "#BF9000",
        "#38761D",
        "#134F5C",
        "#1155CC",
        "#351C75",
        "#741B47",
      ],
      
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
      enum: ["ALL", "ORGANIZATION", "ASSIGNED_TEST"],
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
  },
);

// Indexes
newsUpdatesSchema.index({ visibleFrom: 1 });
newsUpdatesSchema.index({ visibleTill: 1 });
newsUpdatesSchema.index({ audience: 1 });
newsUpdatesSchema.index({ priority: 1 });
newsUpdatesSchema.index({ isActive: 1 });

export default mongoose.model("NewsUpdate", newsUpdatesSchema);
