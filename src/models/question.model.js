// models/Question.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Subject",
    required: false,
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Topic",
    required: false,
  },
  questionText: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["MCQ", "TRUE_FALSE"],
    required: true,
  },
  options: {
    type: [String],
    default: [],
  },
  correctAnswer: {
    type: String,
  },
  imageUrl: {
    type: String,
    default: null,
  },
  difficulty: {
    type: String,
    enum: ["EASY", "MEDIUM", "HARD"],
    default: "EASY",
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  excelBatchId: {
    type: String,
    default: null,
    index: true,
  },

  excelBatchName: {
    type: String,
    default: null,
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Every test-start selects questions by subjectId/topicId/type/difficulty
// (questionSelection.service.js), and the question-bank list/pagination
// endpoints filter the same way — none of it indexed beyond excelBatchId.
questionSchema.index({ subjectId: 1, topicId: 1, type: 1, difficulty: 1 });

export default mongoose.model("Question", questionSchema);
