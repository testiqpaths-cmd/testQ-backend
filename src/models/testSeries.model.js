import mongoose from "mongoose";

const TestSeriesSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,

    createdBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, required: true },
      role: { type: String, enum: ["IQPATH_ADMIN", "ORG"], required: true }
    },

    visibility: {
      type: String,
      enum: ["PUBLIC", "ORG_ONLY", "LINK_ONLY"],
      required: true
    },

    allowedOrganizations: [{ type: mongoose.Schema.Types.ObjectId }],
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Test" }],
    seriesCode: String
  },
  { timestamps: true }
);

export default mongoose.model("TestSeries", TestSeriesSchema);
