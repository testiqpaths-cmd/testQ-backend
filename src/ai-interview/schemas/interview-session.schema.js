import mongoose from "mongoose";
import { InterviewState } from "../enums/interview-state.enum.js";
import { Difficulty } from "../enums/difficulty.enum.js";

const { Schema, model, Types } = mongoose;

const topicCoverageItemSchema = new Schema(
  {
    topic: { type: String, required: true },
    questionsAsked: { type: Number, default: 0 },
    followupsAsked: { type: Number, default: 0 },
    knowledgeGaps: { type: Number, default: 0 },
    coveragePercentage: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    knowledgeLevel: {
      type: String,
      enum: ["NONE", "BASIC", "INTERMEDIATE", "STRONG", "STRONG_FOUNDATION", "EXCELLENT", "DEEP", "MEDIUM", "ADVANCED"],
      default: "NONE",
    },
    fundamentalKnowledge: {
      type: String,
      enum: ["WEAK", "BASIC", "INTERMEDIATE", "STRONG", "EXCELLENT", null],
      default: null,
    },
    advancedDepth: {
      type: String,
      enum: ["WEAK", "BASIC", "INTERMEDIATE", "STRONG", "EXCELLENT", "UNPROVEN", null],
      default: null,
    },
    knowledgeSummary: {
      type: String,
      default: null,
    },
    knowledgeConfidence: { type: Number, default: 0 },
    depthEstablished: { type: Boolean, default: false },
    evidenceLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "LOW",
    },
    breadthLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "LOW",
    },
    depthLevel: {
      type: String,
      enum: ["SHALLOW", "ADEQUATE", "DEEP"],
      default: "SHALLOW",
    },
    misconceptions: { type: [String], default: [] },
    contradictions: { type: [String], default: [] },
    experienceAuthenticity: {
      type: String,
      enum: ["THEORETICAL_TEXTBOOK", "SURFACE_FAMILIARITY", "PRODUCTION_VERIFIED", "UNPROVEN"],
      default: "UNPROVEN",
    },
    conceptsTested: { type: [String], default: [] },
    conceptsKnown: { type: [String], default: [] },
    conceptsMissing: { type: [String], default: [] },
    shouldContinue: { type: Boolean, default: true },
    topicState: {
      type: String,
      enum: ["UNKNOWN", "EXPLORING", "ESTABLISHED"],
      default: "UNKNOWN",
    },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "EVALUATED", "SKIPPED"],
      default: "PENDING",
    },
  },
  { _id: false }
);

const phasePlanItemSchema = new Schema(
  {
    phase: { type: String, required: true },
    topics: { type: [String], default: [] },
    questionBudget: { type: Number, default: 0 },
    questionsAsked: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED"],
      default: "PENDING",
    },
  },
  { _id: false }
);

const preparedQuestionSchema = new Schema(
  {
    questionId: { type: String, required: true },
    topic: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD", "ADAPTIVE"],
      default: "MEDIUM",
    },
    questionType: { type: String, default: "TECHNICAL" },
    competency: { type: String, default: "Technical Knowledge" },
    question: { type: String, required: true, trim: true },
    concept: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["PENDING", "READY", "CLAIMED", "USED", "DISCARDED"],
      default: "READY",
    },
    questionHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    claimedAt: { type: Date, default: null },
    claimOwner: { type: String, default: null },
    claimExpiresAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
  },
  { _id: false }
);

const prefetchedProbeSchema = new Schema(
  {
    probeId: { type: String, required: true },
    parentQuestionId: { type: String, required: true },
    parentTurnNumber: { type: Number, default: 1 },
    topic: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD", "ADAPTIVE"],
      default: "MEDIUM",
    },
    targetConcept: { type: String, default: "", trim: true },
    probeType: {
      type: String,
      enum: [
        "EASY",
        "MEDIUM",
        "HARD",
        "SCENARIO",
        "VALIDATION",
        "CLARIFICATION",
        "DEPTH_PROBE",
        "PRACTICAL",
        "NONE",
      ],
      default: "DEPTH_PROBE",
    },
    probeReason: {
      type: String,
      enum: [
        "MISSING_CONCEPT",
        "SHALLOW_ANSWER",
        "MISCONCEPTION",
        "CONTRADICTION",
        "PRACTICAL_DEPTH",
        "CLARIFICATION",
        "VALIDATION",
        "ADVANCED_TOPIC",
        "GENERAL_FOLLOWUP",
      ],
      default: "MISSING_CONCEPT",
    },
    question: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["PENDING", "READY", "CLAIMED", "USED", "DISCARDED"],
      default: "READY",
    },
    createdAt: { type: Date, default: Date.now },
    usedAt: { type: Date, default: null },
  },
  { _id: false }
);

const interviewSessionSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    interviewId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    interviewType: {
      type: String,
      enum: ["RESUME", "CUSTOM"],
      default: "CUSTOM",
      index: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    experienceLevel: {
      type: String,
      default: "1-3 Years",
      trim: true,
    },
    company: {
      type: String,
      trim: true,
      default: "",
    },
    techStack: {
      type: [String],
      default: [],
    },
    interviewTypes: {
      type: [String],
      default: ["technical"],
    },
    duration: {
      type: Number,
      required: true,
      default: 30, // in minutes
    },
    startTime: {
      type: Date,
    },
    endTime: {
      type: Date,
    },
    currentTopic: {
      type: String,
      default: null,
    },
    currentQuestion: {
      type: Schema.Types.Mixed,
      default: null,
    },
    questionCount: {
      type: Number,
      default: 0,
    },
    topicQuestionCount: {
      type: Number,
      default: 0,
    },
    followUpCount: {
      type: Number,
      default: 0,
    },
    topicFollowUpCount: {
      type: Number,
      default: 0,
    },
    globalFollowUpCount: {
      type: Number,
      default: 0,
    },
    difficulty: {
      type: String,
      enum: Object.values(Difficulty),
      default: Difficulty.ADAPTIVE,
    },
    timeRemaining: {
      type: Number, // in seconds
      default: 1800,
    },
    coverageState: [topicCoverageItemSchema],
    // Phase layer (see constants/interview-phases.js). Ordered stages, each
    // a slice of topicOrder with its own question budget. Empty => the
    // adaptive engine runs flat, exactly as before.
    phasePlan: { type: [phasePlanItemSchema], default: [] },
    currentPhase: { type: String, default: null },
    candidatePerformance: {
      baselineEstablished: { type: Boolean, default: false },
      baselineScore: { type: Number, default: 0 },
      streakCorrect: { type: Number, default: 0 },
      streakGaps: { type: Number, default: 0 },
      consecutiveKnowledgeGapsInTopic: { type: Number, default: 0 },
      runningAccuracy: { type: Number, default: 0 },
    },
    interviewState: {
      type: String,
      enum: Object.values(InterviewState),
      default: InterviewState.CREATED,
      index: true,
    },
    allowedTopics: {
      type: [String],
      default: [],
    },
    topicOrder: {
      type: [String],
      default: [],
    },
    planId: {
      type: Types.ObjectId,
      ref: "InterviewPlan",
    },
    resumeData: {
      type: Schema.Types.Mixed,
      default: null,
    },
    // Computed once by interview-results.service.js the first time results
    // are requested (or eagerly on completion) and never invalidated —
    // InterviewTurns are immutable once a session reaches a terminal state.
    resultsSummary: {
      type: Schema.Types.Mixed,
      default: null,
    },
    resultsComputedAt: {
      type: Date,
      default: null,
    },
    preparedQuestions: {
      type: [preparedQuestionSchema],
      default: [],
    },
    prefetchedProbes: {
      type: [prefetchedProbeSchema],
      default: [],
    },
    poolGenerationLock: {
      lockedUntil: { type: Date, default: null },
      owner: { type: String, default: null },
    },
    // One-time shareable link to launch this interview. `shareToken` is a
    // URL-safe random string; the link is single-use (shareTokenUsedAt) and
    // time-boxed (shareTokenExpiresAt).
    shareToken: {
      type: String,
      default: null,
    },
    shareTokenExpiresAt: {
      type: Date,
      default: null,
    },
    shareTokenUsedAt: {
      type: Date,
      default: null,
    },
    shareTokenCreatedBy: {
      type: Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique only across sessions that actually hold a token. A partial
// filter (not `sparse`) is required because shareToken defaults to null:
// `sparse` would still index every explicit null and collide on the 2nd.
interviewSessionSchema.index(
  { shareToken: 1 },
  { unique: true, partialFilterExpression: { shareToken: { $type: "string" } } }
);

// Helpful compound indexes
interviewSessionSchema.index({ userId: 1, createdAt: -1 });
interviewSessionSchema.index({ userId: 1, interviewState: 1 });

export const InterviewSession =
  mongoose.models.InterviewSession ||
  model("InterviewSession", interviewSessionSchema);

export default InterviewSession;
