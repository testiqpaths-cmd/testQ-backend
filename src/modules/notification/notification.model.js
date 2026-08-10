import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      enum: ["TEST_ASSIGNED", "RESULT", "NEW_TEST", "EVALUATION", "TEST_COMPLETED", "SUBSCRIPTION", "SYSTEM", "LEADERBOARD", "NEWS_UPDATE"],
      default: "SYSTEM",
    },

    link: {
      type: String,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Every read/update/delete in notification.service.js filters by userId
// (and the list view sorts by createdAt) with no supporting index — hit on
// essentially every authenticated page load via the notification bell.
notificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;