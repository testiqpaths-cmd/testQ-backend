import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

// Mirrors testAssignment.model.js, but at the series level — accepting a
// series accepts every test currently in it (see testSeries.controller.js's
// acceptSeriesAssignment, which bulk-upserts a TestAssignment for each), so
// a student never has to accept series-member tests one by one.
const testSeriesAssignmentSchema = new Schema({
  seriesId: { type: Types.ObjectId, ref: "TestSeries", required: true },
  studentId: { type: Types.ObjectId, ref: "User", required: true },
  status: {
    type: String,
    enum: ["PENDING", "ACCEPTED", "DECLINED", "HIDDEN"],
    default: "PENDING"
  },
  acceptedAt: { type: Date },
  declinedAt: { type: Date },
  hiddenAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Ensure a student has at most one assignment per series
testSeriesAssignmentSchema.index({ seriesId: 1, studentId: 1 }, { unique: true });

export default model("TestSeriesAssignment", testSeriesAssignmentSchema);
