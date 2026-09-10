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
    // Cloudinary (resource_type: raw) — the original file, so it can be
    // re-downloaded / re-parsed later. Null if the upload failed (parsing
    // is the critical path; file storage is a bonus).
    fileUrl: { type: String, default: null },
    filePublicId: { type: String, default: null },
    // sha256 of the normalized resume text — lets a re-upload of the same
    // resume reuse the existing record instead of storing a duplicate.
    contentHash: { type: String, default: null, index: true },
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
