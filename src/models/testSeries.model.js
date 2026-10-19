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
    seriesCode: String,

    // Company Exam Preparation fields
    category: {
      type: String,
      enum: ["GENERAL", "COMPANY"],
      default: "GENERAL",
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },
    mode: {
      type: String,
      enum: ["PRACTICE", "SIMULATION"],
      default: "SIMULATION",
    },
    progressionMode: {
      type: String,
      enum: ["SEQUENTIAL", "OPEN"],
      default: "SEQUENTIAL",
    },
    patternVersion: {
      type: String,
      default: "2026",
    },
    passingPercentage: {
      type: Number,
      default: 50,
    },
    roundsConfig: [
      {
        stageOrder: { type: Number, required: true },
        stageKey: { type: String, required: true },
        stageName: { type: String, default: "" },
        cutoffPercentage: { type: Number, default: 50 },
        retakePolicy: {
          type: String,
          enum: ["ALL_TESTS", "FAILED_ONLY"],
          default: "ALL_TESTS",
        },
      },
    ],

    // Experience-Specific Hiring Track fields
    experienceLevel: {
      type: String,
      enum: ["FRESHER", "EXPERIENCED_1_3", "EXPERIENCED_3_PLUS", "ALL"],
      default: "FRESHER",
      index: true,
    },
    targetRole: {
      type: String,
      default: "Software Engineer",
      trim: true,
    },
    hiringRounds: [
      {
        roundOrder: { type: Number, required: true, min: 1 },
        roundKey: { type: String, required: true, trim: true },
        roundName: { type: String, required: true, trim: true },
        roundType: {
          type: String,
          enum: ["TESTS", "AI_INTERVIEW"],
          default: "TESTS",
        },
        cutoffPercentage: { type: Number, min: 0, max: 100, default: 50 },
        weight: { type: Number, min: 0, default: 100 },
        retakePolicy: {
          type: String,
          enum: ["ALL_TESTS", "FAILED_ONLY"],
          default: "ALL_TESTS",
        },
        tests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Test" }],
        aiInterviewConfig: {
          role: { type: String, default: "Software Engineer", trim: true },
          experienceLevel: { type: String, default: "Fresher", trim: true },
          topics: { type: [String], default: [] },
          duration: { type: Number, min: 5, max: 120, default: 30 },
          difficulty: {
            type: String,
            enum: ["EASY", "MEDIUM", "HARD", "ADAPTIVE"],
            default: "MEDIUM",
          },
          customRubric: { type: String, default: null },
          interviewTypes: { type: [String], default: ["technical"] },
        },
      },
    ],
    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// "My series" listing filters by createdBy.userId; duplicate-title checks
// on every series creation query by title. Neither was indexed.
TestSeriesSchema.index({ "createdBy.userId": 1 });
TestSeriesSchema.index({ title: 1 });
TestSeriesSchema.index({ category: 1, companyId: 1, createdAt: -1 });
TestSeriesSchema.index({ category: 1, companyId: 1, experienceLevel: 1 });

export default mongoose.models.TestSeries || mongoose.model("TestSeries", TestSeriesSchema);
