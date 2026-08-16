import mongoose from "mongoose";

const TestSeriesSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,

    // Creator-declared total the series is planned to eventually contain —
    // distinct from `tests.length` (how many have actually been added so
    // far), since a series is often built up incrementally over time.
    // Optional: an older series (or one whose creator didn't fill it in)
    // has no planned total, so callers should fall back to tests.length.
    plannedTestCount: { type: Number, min: 0, default: null },

    createdBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, required: true },
      role: { type: String, enum: ["IQPATH_ADMIN", "ORGANIZATION","STUDENT"], required: true }
    },

    visibility: {
      type: String,
      enum: ["PUBLIC", "ORG_ONLY", "LINK_ONLY", "SELECT_STUDENT"],
      required: true
    },

    allowedOrganizations: [{ type: mongoose.Schema.Types.ObjectId }],
    allowedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Test" }],
    seriesCode: String
  },
  { timestamps: true }
);

// "My series" listing filters by createdBy.userId; duplicate-title checks
// on every series creation query by title. Neither was indexed.
TestSeriesSchema.index({ "createdBy.userId": 1 });
TestSeriesSchema.index({ title: 1 });

export default mongoose.model("TestSeries", TestSeriesSchema);
