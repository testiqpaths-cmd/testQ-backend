import mongoose from "mongoose";
import { Difficulty } from "../enums/difficulty.enum.js";
import { AnswerStatus } from "../enums/answer-status.enum.js";

const { Schema, model, Types } = mongoose;

const interviewTurnSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    interviewId: {
      type: String,
      required: true,
      index: true,
    },
    turnNumber: {
      type: Number,
      required: true,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    // Embedding of `question` (Gemini text-embedding-004). Used for
    // cross-interview semantic dedup so a candidate isn't asked the same
    // question twice in different words. Absent when no AI key is set.
    questionEmbedding: {
      type: [Number],
      default: undefined,
      select: false,
    },
    questionType: {
      type: String,
      enum: ["TECHNICAL", "CONCEPTUAL", "PROBLEM_SOLVING", "BEHAVIORAL", "PROJECT", "HR"],
      default: "TECHNICAL",
    },
    difficulty: {
      type: String,
      enum: Object.values(Difficulty),
      default: Difficulty.EASY,
    },
    competency: {
      type: String,
      default: "Technical Knowledge",
    },
    // Where this question came from: a live AI call, the reusable DB
    // QuestionBank, or the small hardcoded fallback set.
    questionSource: {
      type: String,
      enum: ["ai_generated", "bank", "fallback", "predefined"],
      default: "ai_generated",
    },
    questionBankId: {
      type: Types.ObjectId,
      ref: "QuestionBank",
      default: null,
    },
    // Cloudinary URL of the synthesized narration for `question`, filled
    // lazily by GET /sessions/:id/question-audio. Null when TTS is off.
    questionAudioUrl: {
      type: String,
      default: null,
    },
    questionTimestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
    candidateAnswer: {
      type: String,
      default: null,
      trim: true,
    },
    answerTimestamp: {
      type: Date,
      default: null,
    },
    timeTakenSeconds: {
      type: Number,
      default: null,
    },
    audioReference: {
      type: String,
      default: null,
      trim: true,
    },
    // How the answer turn ended:
    //  answered            - candidate submitted normally
    //  timeout_pause       - auto-submitted a partial answer after a long
    //                        silence mid-answer (still judged on its merits)
    //  timeout_no_response - the candidate said/typed nothing before the
    //                        response timer ran out (scored as SKIPPED, 0)
    //  manual_skip         - candidate chose to skip
    endedReason: {
      type: String,
      enum: ["answered", "timeout_pause", "timeout_no_response", "manual_skip"],
      default: "answered",
    },
    processingState: {
      type: String,
      enum: ["QUESTION_GENERATED", "SUBMITTED", "ANALYZED", "EVALUATED"],
      default: "QUESTION_GENERATED",
    },
    answerStatus: {
      type: String,
      enum: [...Object.values(AnswerStatus), null],
      default: null,
    },
    relevanceScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    correctnessScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    completenessScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    confidence: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    conceptsDemonstrated: {
      type: [String],
      default: [],
    },
    conceptsMissing: {
      type: [String],
      default: [],
    },
    feedbackSummary: {
      type: String,
      default: null,
    },
    followUpRecommended: {
      type: Boolean,
      default: false,
    },
    difficultyRecommendation: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD", null],
      default: null,
    },
    topicContinuationRecommended: {
      type: Boolean,
      default: true,
    },
    analysisTimestamp: {
      type: Date,
      default: null,
    },
    knowledgeLevel: {
      type: String,
      enum: ["NONE", "BASIC", "MEDIUM", "ADVANCED", null],
      default: null,
    },
    topicCoverage: {
      type: Number,
      default: null,
    },
    evaluation: {
      type: Schema.Types.Mixed,
      default: null,
    },
    followUp: {
      type: Boolean,
      default: false,
    },
    isFollowUp: {
      type: Boolean,
      default: false,
    },
    followUpAllowed: {
      type: Boolean,
      default: false,
    },
    parentTurnId: {
      type: Types.ObjectId,
      ref: "InterviewTurn",
      default: null,
    },
    concept: {
      type: String,
      trim: true,
      default: null,
    },
    depthLevel: {
      type: String,
      enum: ["SHALLOW", "ADEQUATE", "DEEP", null],
      default: null,
    },
    subIndex: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to quickly fetch chronological transcript for a session
interviewTurnSchema.index({ sessionId: 1, turnNumber: 1 });
interviewTurnSchema.index({ interviewId: 1, turnNumber: 1 });

export const InterviewTurn =
  mongoose.models.InterviewTurn || model("InterviewTurn", interviewTurnSchema);

export default InterviewTurn;
