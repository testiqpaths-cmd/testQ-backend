import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const testSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String },
  subjectId: { type: Types.ObjectId, ref: "Subject"},
  createdBy: {
    userId: { type: Types.ObjectId, required: true },
    role: { type: String, enum:["IQPATH_ADMIN", "ORGANIZATION", "STUDENT"], required: true },
  },
  visibility: { type: String, enum: ["PUBLIC", "ORG_ONLY", "LINK_ONLY"], required: true },
  allowedOrganizations: [{ type: Types.ObjectId }],
  testCode: { type: String },
  totalQuestions: { type: Number, required: true },
  questionSource: {
    type: String,
    enum: ["SUBJECT_TOPIC", "EXCEL"],
    default: "SUBJECT_TOPIC",
  },
  excelBatchId: { type: String, default: null },
  subjectIds: [{ type: Types.ObjectId, ref: "Subject", required: true }],
  topicIds: [{ type: Types.ObjectId, ref: "Topic" }],
  difficulty: [{ type: String }],
  type: [{ type: String }],
  duration: { type: Number, required: true },
  maxAttempts: { type: Number, default: 1 },
  totalMarks: { type: Number, required: true },
  scheduleType: { type: String, enum: ["IMMEDIATE", "DELAYED", "FIXED"], required: true },
  delayDays: { type: Number }, // ✅ must be Number
  startTime: { type: Date },
  endTime: { type: Date },
  isPublished: { type: Boolean, default: false },
  status: { type: String, enum: ["DRAFT", "UPCOMING", "ACTIVE", "COMPLETED"], default: "DRAFT" },
  testSeriesId: { type: Types.ObjectId, ref: "TestSeries" },
  isSeriesTest: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  isDeleted: {
  type: Number,
  enum: [0, 1],
  default: 0,
},
});

export default model("Test", testSchema);
