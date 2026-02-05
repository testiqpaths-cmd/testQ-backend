import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const testSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String },
  createdBy: {
    userId: { type: Types.ObjectId, required: true },
    role: { type: String, enum:["IQPATH_ADMIN", "ORGANIZATIONS", "STUDENT"], required: true },
  },
  visibility: { type: String, enum: ["PUBLIC", "ORG_ONLY", "LINK_ONLY"], required: true },
  allowedOrganizations: [{ type: Types.ObjectId }],
  testCode: { type: String },
  questionMode: { type: String, enum: ["MANUAL", "RANDOM"], required: true },
  questions: [{ type: Types.ObjectId }],
  randomConfig: {
    totalQuestions: { type: Number },
    topic: [{ type: String }],
    difficulty: [{ type: String }],
    type: [{ type: String }],
  },
  duration: { type: Number, required: true },
  totalMarks: { type: Number, required: true },
  scheduleType: { type: String, enum: ["IMMEDIATE", "DELAYED", "FIXED"], required: true },
  delayDays: { type: Number }, // ✅ must be Number
  startTime: { type: Date },
  endTime: { type: Date },
  isPublished: { type: Boolean, default: false },
  testSeriesId: { type: Types.ObjectId, ref: "TestSeries" },
  createdAt: { type: Date, default: Date.now },
});

export default model("Test", testSchema);
