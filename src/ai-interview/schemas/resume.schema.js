import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

// A minimal, deliberately non-comprehensive resume record — just enough to
// back "GET saved resume" and let a resume-based interview be created from
// a resumeId instead of always re-uploading the file. Not a resume
// management system (no versioning, no delete/list endpoints).
const resumeSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    resumeId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    filename: String,
    sizeBytes: Number,
    mimetype: String,
    rawText: {
      type: String,
      default: "",
    },
    extracted: {
      skills: { type: [String], default: [] },
      detectedExperienceYears: { type: Number, default: 0 },
      summaryPreview: { type: String, default: "" },
    },
    scopedTopics: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

resumeSchema.index({ userId: 1, createdAt: -1 });

export const Resume = mongoose.models.Resume || model("Resume", resumeSchema);

export default Resume;
