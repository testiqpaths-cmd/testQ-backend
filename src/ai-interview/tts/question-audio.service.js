import crypto from "crypto";
import { QuestionAudio } from "../schemas/question-audio.schema.js";
import { ttsProviderService } from "./tts-provider.service.js";
import { uploadBufferToCloudinary } from "../../common/utils/cloudinary.js";
import logger from "../../config/logger.js";

const AUDIO_FOLDER = "ai-interview/question-audio";

const normalize = (t) => String(t || "").trim().replace(/\s+/g, " ");

export class QuestionAudioService {
  isEnabled() {
    return ttsProviderService.isEnabled();
  }

  hashFor(text, { provider, model, voice }) {
    return crypto
      .createHash("sha256")
      .update(`${provider}|${model}|${voice}|${normalize(text).toLowerCase()}`)
      .digest("hex");
  }

  /**
   * Returns { url, mimeType } for the narration of `text`, generating and
   * caching it on first request. Returns null when TTS is disabled or the
   * provider call / upload fails — callers fall back to text-only.
   */
  async getOrCreate(text, { interviewId = null } = {}) {
    if (!this.isEnabled() || !normalize(text)) return null;

    const desc = ttsProviderService.descriptor();
    const audioHash = this.hashFor(text, desc);

    try {
      const cached = await QuestionAudio.findOne({ audioHash }).lean();
      if (cached?.url) return { url: cached.url, mimeType: cached.mimeType };
    } catch (err) {
      logger.warn(`QuestionAudio cache read failed (non-fatal): ${err.message}`);
    }

    const synth = await ttsProviderService.synthesize(text, { interviewId });
    if (!synth?.buffer?.length) return null;

    let uploaded;
    try {
      uploaded = await uploadBufferToCloudinary(synth.buffer, synth.mimeType, AUDIO_FOLDER, {
        resource_type: "video", // Cloudinary stores audio under "video"
        public_id: audioHash,
        overwrite: false,
      });
    } catch (err) {
      logger.warn(`QuestionAudio upload failed (non-fatal): ${err.message}`);
      return null;
    }

    const url = uploaded?.secure_url || uploaded?.url || null;
    if (!url) return null;

    try {
      await QuestionAudio.updateOne(
        { audioHash },
        {
          $setOnInsert: {
            audioHash,
            text: normalize(text).slice(0, 2000),
            provider: desc.provider,
            model: desc.model,
            voice: desc.voice,
            url,
            publicId: uploaded.public_id || audioHash,
            mimeType: synth.mimeType,
            bytes: synth.buffer.length,
          },
        },
        { upsert: true }
      );
    } catch (err) {
      if (err.code !== 11000) {
        logger.warn(`QuestionAudio cache write failed (non-fatal): ${err.message}`);
      }
    }

    return { url, mimeType: synth.mimeType };
  }
}

export const questionAudioService = new QuestionAudioService();
export default questionAudioService;
