import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const sourceCountsSchema = new Schema(
  {
    selfCreated: {
      type: Number,
      default: 0,
    },
    organization: {
      type: Number,
      default: 0,
    },
    admin: {
      type: Number,
      default: 0,
    },
    iqRoom: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const subjectStatSchema = new Schema(
  {
    subjectName: {
      type: String,
      default: "General",
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    scoreSum: {
      type: Number,
      default: 0,
    },
    scoredAttemptCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const platformDailySummarySchema = new Schema(
  {
    dateKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },

    totalAttempts: {
      type: Number,
      default: 0,
    },

    scoreSum: {
      type: Number,
      default: 0,
    },

    scoredAttemptCount: {
      type: Number,
      default: 0,
    },

    sourceCounts: {
      type: sourceCountsSchema,
      default: () => ({}),
    },

    // Map keyed by subjectId string (e.g. "6a1a..."): prevents array update race conditions
    subjectStats: {
      type: Map,
      of: subjectStatSchema,
      default: () => new Map(),
    },

    activeStudentCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

platformDailySummarySchema.index(
  { dateKey: 1, organizationId: 1 },
  {
    unique: true,
    name: "unique_platform_daily_scope",
  }
);

platformDailySummarySchema.index(
  { organizationId: 1, dateKey: -1 },
  { name: "platform_daily_scope_history" }
);

const PlatformDailySummary =
  models.PlatformDailySummary ||
  model("PlatformDailySummary", platformDailySummarySchema);

export default PlatformDailySummary;
