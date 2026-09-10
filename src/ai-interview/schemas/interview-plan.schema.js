import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

const interviewPlanSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: "InterviewSession",
      index: true,
    },
    duration: {
      type: Number,
      required: true,
      min: 5,
      max: 120,
      default: 30,
    },
    topics: {
      type: [String],
      required: true,
      validate: [
        (val) => Array.isArray(val) && val.length > 0,
        "Interview plan must include at least one topic.",
      ],
    },
    difficulty: {
      type: String,
      enum: ["EASY", "MEDIUM", "HARD", "ADAPTIVE"],
      default: "ADAPTIVE",
    },
    maxQuestionsPerTopic: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
    },
    maxFollowUpsPerQuestion: {
      type: Number,
      default: 1,
      min: 0,
      max: 2,
    },
    maxGlobalFollowUps: {
      type: Number,
      default: 3,
      min: 0,
      max: 10,
    },
    globalQuestionLimit: {
      type: Number,
      default: 10,
      min: 3,
      max: 30,
    },
    topicBudgets: [
      {
        topic: { type: String, required: true },
        targetQuestions: { type: Number, default: 2 },
        allocatedMinutes: { type: Number, default: 5 },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export const InterviewPlan =
  mongoose.models.InterviewPlan || model("InterviewPlan", interviewPlanSchema);

export default InterviewPlan;
