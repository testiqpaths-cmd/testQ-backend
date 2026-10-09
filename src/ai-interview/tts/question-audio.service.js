import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { InterviewTurn } from "../schemas/interview-turn.schema.js";
import logger from "../../config/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_AUDIO_FILE = path.join(__dirname, "../../../public/audio/here-is-the-question.mp3");
const STATIC_AUDIO_URL = "/audio/here-is-the-question.mp3";

/**
 * QuestionAudioService serves the pre-recorded, static audio prompt
 * ("Here is your question.") for every question displayed on screen.
 * This completely avoids dynamic Gemini TTS conversion delay, latency,
 * and rate-limiting, ensuring instant 0ms question transitions.
 */
export class QuestionAudioService {
  constructor() {
    this._staticBuffer = null;
    this._loadStaticBuffer();
  }

  _loadStaticBuffer() {
    try {
      if (fs.existsSync(STATIC_AUDIO_FILE)) {
        this._staticBuffer = fs.readFileSync(STATIC_AUDIO_FILE);
      }
    } catch (err) {
      logger.warn(`Could not preload static question audio: ${err.message}`);
    }
  }

  isEnabled() {
    return String(process.env.AI_INTERVIEW_TTS_ENABLED || "true").toLowerCase() !== "false";
  }

  /**
   * Returns instant static audio stream URL.
   */
  getCachedStreamUrl(text) {
    if (!this.isEnabled()) return null;
    if (text && String(text).toLowerCase().includes("tell me about yourself")) {
      return "/audio/first-question.mp3";
    }
    return STATIC_AUDIO_URL;
  }

  /**
   * Returns memory buffer for streaming endpoint.
   */
  getCachedBuffer(_audioHash) {
    if (!this._staticBuffer) {
      this._loadStaticBuffer();
    }
    if (this._staticBuffer) {
      return {
        buffer: this._staticBuffer,
        mimeType: "audio/mpeg",
        timestamp: Date.now(),
      };
    }
    return null;
  }

  /**
   * Returns { url, mimeType } pointing to the static pre-recorded question audio.
   */
  async getOrCreate(text, { interviewId = null } = {}) {
    if (!this.isEnabled()) return null;
    const isFirst = text && String(text).toLowerCase().includes("tell me about yourself");
    const url = isFirst ? "/audio/first-question.mp3" : STATIC_AUDIO_URL;
    return {
      url,
      mimeType: "audio/mpeg",
    };
  }

  /**
   * Fast no-op prewarm since static audio is already pre-generated and stored.
   */
  prewarm(_text, { interviewId = null } = {}) {
    // No-op: static audio is already available instantaneously
  }

  /**
   * Ensures the turn has questionAudioUrl set to the static prompt and pushes
   * socket notification immediately so candidate client is aware.
   */
  prewarmForTurn(turnId, text, { interviewId = null } = {}) {
    if (!this.isEnabled() || !turnId) return;

    const isFirst = text && String(text).toLowerCase().includes("tell me about yourself");
    const audioUrl = isFirst ? "/audio/first-question.mp3" : STATIC_AUDIO_URL;

    InterviewTurn.updateOne(
      { _id: turnId },
      { questionAudioUrl: audioUrl }
    ).catch((err) => {
      logger.warn(`Persisting questionAudioUrl failed (non-fatal): ${err.message}`);
    });

    if (interviewId) {
      import("../../sockets/index.js")
        .then(({ getIO }) => {
          const io = getIO();
          if (io) {
            io.of("/ai-interview")
              .to(`interview:${interviewId}`)
              .emit("question:audio-ready", {
                turnId: String(turnId),
                url: audioUrl,
                mimeType: "audio/mpeg",
              });
          }
        })
        .catch(() => {});
    }
  }
}

export const questionAudioService = new QuestionAudioService();
export default questionAudioService;
