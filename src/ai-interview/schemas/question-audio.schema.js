import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Cache of synthesized question audio. Keyed by a hash of
 * (text + provider + model + voice) so the same question narrated by the
 * same voice is only ever generated and uploaded once. Rows auto-expire
 * after 180 days (the Cloudinary asset should be lifecycle-managed too).
 */
const questionAudioSchema = new Schema({
  audioHash: { type: String, required: true, unique: true, index: true },
  text: { type: String, required: true },
  provider: { type: String, default: null },
  model: { type: String, default: null },
  voice: { type: String, default: null },
  url: { type: String, required: true },
  publicId: { type: String, default: null },
  mimeType: { type: String, default: "audio/wav" },
  bytes: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});

export const QuestionAudio =
  mongoose.models.QuestionAudio || model("QuestionAudio", questionAudioSchema);

export default QuestionAudio;
