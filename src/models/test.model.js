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
  visibility: { type: String, enum: ["PUBLIC", "ORG_ONLY", "LINK_ONLY", "SELECT_STUDENT"], required: true },
  allowedOrganizations: [{ type: Types.ObjectId }],
  allowedStudents: [{ type: Types.ObjectId, ref: "User" }],
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
  marksPerQuestion: { type: Number, required: true, default: 1 },
  negativeMarkingPercentage: { type: Number, default: 0 },
  scheduleType: { type: String, enum: ["IMMEDIATE", "DELAYED", "FIXED"], required: true },
  delayDays: { type: Number }, // ✅ must be Number
  startTime: { type: Date },
  endTime: { type: Date },
  isPublished: { type: Boolean, default: false },
  publishedAt: { type: Date },
  status: { type: String, enum: ["DRAFT", "PUBLISHED", "UPCOMING", "ACTIVE", "COMPLETED"], default: "DRAFT" },
  testSeriesId: { type: Types.ObjectId, ref: "TestSeries" },
  isSeriesTest: { type: Boolean, default: false },
  isIQRoomTest: { type: Boolean, default: false },
  // Gates the normal browser-tab attempt-start path (see
  // test-attempts/testAttempt.controller.js) behind an ACTIVE ExamSession
  // claimed by the testQ-browser Electron app.
  secureBrowserRequired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  isDeleted: {
  type: Number,
  enum: [0, 1],
  default: 0,
},
});

// Test had zero indexes despite being queried constantly by these exact
// filter+sort shapes (getAssignedTests, getMyTests, dashboard counts, series
// lookups) — every one of those was a full collection scan that gets slower
// as the platform's total test count grows.
testSchema.index({ isDeleted: 1, isPublished: 1, isIQRoomTest: 1, createdAt: -1 });
testSchema.index({ "createdBy.userId": 1, isDeleted: 1, createdAt: -1 });
testSchema.index({ status: 1, isDeleted: 1 });
testSchema.index({ testSeriesId: 1 });

export default model("Test", testSchema);
