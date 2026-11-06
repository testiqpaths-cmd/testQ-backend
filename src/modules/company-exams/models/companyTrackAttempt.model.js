import mongoose from "mongoose";

const roundAttemptSchema = new mongoose.Schema(
  {
    roundOrder: {
      type: Number,
      required: true,
      min: 1,
    },
    roundKey: {
      type: String,
      required: true,
      trim: true,
    },
    roundName: {
      type: String,
      required: true,
      trim: true,
    },
    roundType: {
      type: String,
      enum: ["TESTS", "AI_INTERVIEW"],
      default: "TESTS",
    },
    status: {
      type: String,
      enum: ["LOCKED", "READY", "IN_PROGRESS", "PASSED", "FAILED"],
      default: "READY",
    },
    scoreObtained: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    cutoffPercentage: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
    },
    testAttemptIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TestAttempt",
      },
    ],
    // Correlates with InterviewSession.interviewId (UUID string)
    interviewSessionId: {
      type: String,
      default: null,
    },
    evaluatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: true }
);

const companyTrackAttemptSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    trackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestSeries",
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    driveAttemptNumber: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "QUALIFIED", "NOT_QUALIFIED"],
      default: "IN_PROGRESS",
      index: true,
    },
    currentRoundOrder: {
      type: Number,
      default: 1,
      min: 1,
    },
    roundAttempts: {
      type: [roundAttemptSchema],
      default: [],
    },
    overallScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    overallPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    overallReadinessBand: {
      type: String,
      default: "Needs More Practice",
      trim: true,
    },
    summaryRecommendations: {
      type: [String],
      default: [],
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Unique compound index: a student can have multiple sequential drive attempts (1, 2, 3...) on a track
companyTrackAttemptSchema.index(
  { studentId: 1, trackId: 1, driveAttemptNumber: 1 },
  { unique: true }
);

// Ensure only one active IN_PROGRESS attempt exists per student and track
companyTrackAttemptSchema.index(
  { studentId: 1, trackId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "IN_PROGRESS" },
  }
);

// Efficient lookups for candidate drive history and company statistics
companyTrackAttemptSchema.index({ studentId: 1, companyId: 1, status: 1 });
companyTrackAttemptSchema.index({ trackId: 1, status: 1 });
companyTrackAttemptSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.CompanyTrackAttempt ||
  mongoose.model("CompanyTrackAttempt", companyTrackAttemptSchema);
