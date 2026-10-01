import fs from "fs";
import path from "path";
import crypto from "crypto";
import { QuestionAudio } from "../schemas/question-audio.schema.js";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import { ttsProviderService } from "./tts-provider.service.js";
import { uploadBufferToCloudinary } from "../../common/utils/cloudinary.js";
import logger from "../../config/logger.js";

const AUDIO_FOLDER = "ai-interview/question-audio";
const LOCAL_CACHE_DIR = path.join(process.cwd(), "tmp", "audio-cache");
try {
  if (!fs.existsSync(LOCAL_CACHE_DIR)) {
    fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
  }
} catch {
  // Non-fatal
}

const normalize = (t) => String(t || "").trim().replace(/\s+/g, " ");

export class QuestionAudioService {
  constructor() {
    // audioHash -> in-flight synth promise, so a background pre-generate
    // and the client's fetch for the same question don't both call the
    // TTS API (which wastes quota and worsens 429s).
    this._inflight = new Map();
    // Fast memory buffer cache: audioHash -> { buffer, mimeType, timestamp }
    // Delivers audio immediately to candidate without waiting 3-5s for Cloudinary upload!
    this._bufferCache = new Map();
  }

  isEnabled() {
    return ttsProviderService.isEnabled();
  }

  getCachedBuffer(audioHash) {
    if (this._bufferCache.has(audioHash)) {
      return this._bufferCache.get(audioHash);
    }
    try {
      const base = path.join(LOCAL_CACHE_DIR, audioHash);
      for (const ext of ["wav", "mp3", "bin"]) {
        const filePath = `${base}.${ext}`;
        if (fs.existsSync(filePath)) {
          const buffer = fs.readFileSync(filePath);
          let mimeType = ext === "mp3" ? "audio/mpeg" : "audio/wav";
          const metaPath = `${base}.meta.json`;
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
              if (meta.mimeType) mimeType = meta.mimeType;
            } catch {}
          }
          const item = { buffer, mimeType, timestamp: Date.now() };
          this._bufferCache.set(audioHash, item);
          return item;
        }
      }
    } catch (e) {
      // Non-fatal
    }
    return null;
  }

  setCachedBuffer(audioHash, buffer, mimeType) {
    if (this._bufferCache.size > 60) {
      const firstKey = this._bufferCache.keys().next().value;
      if (firstKey) this._bufferCache.delete(firstKey);
    }
    this._bufferCache.set(audioHash, { buffer, mimeType, timestamp: Date.now() });

    try {
      const ext = mimeType?.includes("mpeg") || mimeType?.includes("mp3") ? "mp3" : "wav";
      const filePath = path.join(LOCAL_CACHE_DIR, `${audioHash}.${ext}`);
      const metaPath = path.join(LOCAL_CACHE_DIR, `${audioHash}.meta.json`);
      fs.writeFileSync(filePath, buffer);
      fs.writeFileSync(metaPath, JSON.stringify({ mimeType, createdAt: Date.now() }));
    } catch {
      // Non-fatal
    }
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

    // 1. Fast in-memory buffer check: instant 0ms response
    const mem = this.getCachedBuffer(audioHash);
    if (mem) {
      return {
        url: `/api/ai-interview/audio/stream/${audioHash}`,
        mimeType: mem.mimeType,
      };
    }

    // 2. Persistent Cloudinary cache check
    try {
      const cached = await QuestionAudio.findOne({ audioHash }).lean();
      if (cached?.url) return { url: cached.url, mimeType: cached.mimeType };
    } catch (err) {
      logger.warn(`QuestionAudio cache read failed (non-fatal): ${err.message}`);
    }

    if (this._inflight.has(audioHash)) return this._inflight.get(audioHash);

    const p = this.#synthAndStore(text, audioHash, desc, interviewId).finally(() =>
      this._inflight.delete(audioHash)
    );
    this._inflight.set(audioHash, p);
    return p;
  }

  /**
   * Fire-and-forget: warm the cache for a question's audio so it's ready
   * by the time the client asks for it. Never throws.
   */
  prewarm(text, { interviewId = null } = {}) {
    if (!this.isEnabled() || !normalize(text)) return;
    this.getOrCreate(text, { interviewId }).catch(() => {});
  }

  /**
   * Same as prewarm(), but for a specific InterviewTurn: once synthesis
   * finishes it persists the URL on that turn AND pushes a socket event
   * to the interview's room, so the room reveals text+audio together the
   * moment it's ready instead of waiting for the client's next poll tick
   * (polling backoff alone can add several extra seconds on top of
   * synthesis time). Fire-and-forget; never throws.
   */
  prewarmForTurn(turnId, text, { interviewId = null } = {}) {
    if (!this.isEnabled() || !normalize(text) || !turnId) return;

    this.getOrCreate(text, { interviewId })
      .then(async (audio) => {
        if (!audio?.url) return;

        try {
          await InterviewTurn.updateOne({ _id: turnId }, { questionAudioUrl: audio.url });
        } catch (err) {
          logger.warn(`Persisting prewarmed questionAudioUrl failed (non-fatal): ${err.message}`);
        }

        if (!interviewId) return;
        try {
          const { getIO } = await import("../../sockets/index.js");
          getIO()
            .of("/ai-interview")
            .to(`interview:${interviewId}`)
            .emit("question:audio-ready", {
              turnId: String(turnId),
              url: audio.url,
              mimeType: audio.mimeType,
            });
        } catch (err) {
          logger.warn(`Pushing question:audio-ready failed (non-fatal): ${err.message}`);
        }
      })
      .catch(() => {});
  }

  async #synthAndStore(text, audioHash, desc, interviewId) {
    const synth = await ttsProviderService.synthesize(text, { interviewId });
    if (!synth?.buffer?.length) return null;

    // Immediately cache in memory for sub-second serving to candidate
    this.setCachedBuffer(audioHash, synth.buffer, synth.mimeType);

    const streamUrl = `/api/ai-interview/audio/stream/${audioHash}`;

    // Upload to Cloudinary asynchronously in background for permanent storage.
    // Candidate does NOT wait for Cloudinary roundtrip!
    this.#uploadToCloudinaryBackground(text, audioHash, desc, synth).catch(() => {});

    return { url: streamUrl, mimeType: synth.mimeType };
  }

  async #uploadToCloudinaryBackground(text, audioHash, desc, synth) {
    let uploaded = null;
    try {
      uploaded = await uploadBufferToCloudinary(synth.buffer, synth.mimeType, AUDIO_FOLDER, {
        resource_type: "video",
        public_id: audioHash,
        overwrite: false,
      });
    } catch (err) {
      logger.warn(`QuestionAudio upload failed (non-fatal): ${err.message}`);
      return;
    }

    const url = uploaded?.secure_url || uploaded?.url || null;
    if (!url) return;

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
  }
}

export const questionAudioService = new QuestionAudioService();
export default questionAudioService;
