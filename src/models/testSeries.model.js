import mongoose from "mongoose";

const TestSeriesSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,

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
