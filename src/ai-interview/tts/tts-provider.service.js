import axios from "axios";
import { AiCallLog } from "../schemas/ai-call-log.schema.js";
import logger from "../../config/logger.js";

async function logCall(row) {
  try {
    await AiCallLog.create({ ...row, purpose: "tts" });
  } catch (err) {
    logger.warn(`AiCallLog (tts) write failed (non-fatal): ${err.message}`);
  }
}

/** Wrap raw signed-16-bit little-endian PCM in a minimal WAV container. */
function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Pull "rate=NNNNN" out of a mime like "audio/L16;codec=pcm;rate=24000". */
function sampleRateFromMime(mime, fallback = 24000) {
  const m = /rate=(\d+)/i.exec(mime || "");
  return m ? Number(m[1]) : fallback;
}

/**
 * Provider-agnostic text-to-speech. Gemini is the default (it's the one
 * provider this deployment has a key for); ElevenLabs and OpenAI are wired
 * but inert until their keys are set. Disabled entirely unless
 * AI_INTERVIEW_TTS_ENABLED=true, since it adds latency and cost per
 * question.
 *
 * synthesize() resolves to { buffer, mimeType, ext } or null.
 */
export class TtsProviderService {
  constructor() {
    this.provider = (process.env.AI_INTERVIEW_TTS_PROVIDER || "gemini").toLowerCase();
    this.enabled = String(process.env.AI_INTERVIEW_TTS_ENABLED || "false").toLowerCase() === "true";
    // Gemini's TTS preview models are usually 2-5s but occasionally hang;
    // a shorter timeout + one retry beats a single long wait.
    this.timeoutMs = Number(process.env.AI_TTS_TIMEOUT_MS) || 18000;

    this.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
    this.geminiModel = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
    this.geminiVoice = process.env.GEMINI_TTS_VOICE || "Kore";

    this.elevenApiKey = process.env.ELEVENLABS_API_KEY || null;
    this.elevenVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    this.elevenModel = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";

    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
    this.openaiTtsModel = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    this.openaiVoice = process.env.OPENAI_TTS_VOICE || "alloy";
  }

  isEnabled() {
    if (!this.enabled) return false;
    if (this.provider === "gemini") return Boolean(this.geminiApiKey);
    if (this.provider === "elevenlabs") return Boolean(this.elevenApiKey);
    if (this.provider === "openai") return Boolean(this.openaiApiKey);
    return false;
  }

  /** @returns {{voice:string, model:string, provider:string}} for cache keys */
  descriptor() {
    if (this.provider === "elevenlabs") {
      return { provider: "elevenlabs", model: this.elevenModel, voice: this.elevenVoiceId };
    }
    if (this.provider === "openai") {
      return { provider: "openai", model: this.openaiTtsModel, voice: this.openaiVoice };
    }
    return { provider: "gemini", model: this.geminiModel, voice: this.geminiVoice };
  }

  async #dispatch(text) {
    if (this.provider === "elevenlabs") return this.callElevenLabs(text);
    if (this.provider === "openai") return this.callOpenAI(text);
    return this.callGemini(text);
  }

  async synthesize(text, { interviewId = null } = {}) {
    if (!this.isEnabled() || !text || !String(text).trim()) return null;
    const start = Date.now();
    try {
      let out = null;
      try {
        out = await this.#dispatch(text);
      } catch (err) {
        const retryable = err.code === "ECONNABORTED" || /timeout/i.test(err.message || "") || err.response?.status === 503;
        if (!retryable) throw err;
        out = await this.#dispatch(text); // one retry for a transient hang
      }

      await logCall({
        interviewId,
        provider: this.provider,
        model: this.descriptor().model,
        latencyMs: Date.now() - start,
        status: out ? "success" : "error",
      });
      return out;
    } catch (err) {
      await logCall({
        interviewId,
        provider: this.provider,
        model: this.descriptor().model,
        latencyMs: Date.now() - start,
        status: err.response?.status === 429 ? "rate_limited" : "error",
        httpStatus: err.response?.status ?? null,
        errorMessage: (err.message || "").slice(0, 300),
      });
      logger.warn(`TTS (${this.provider}) failed (non-fatal): ${err.message}`);
      return null;
    }
  }

  async callGemini(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const payload = {
      contents: [{ parts: [{ text: `Say in a warm, professional interviewer voice: ${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.geminiVoice } } },
      },
    };
    const res = await axios.post(url, payload, {
      timeout: this.timeoutMs,
      headers: { "Content-Type": "application/json" },
    });
    const inline = res.data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline?.data) return null;
    const pcm = Buffer.from(inline.data, "base64");
    const wav = pcmToWav(pcm, { sampleRate: sampleRateFromMime(inline.mimeType) });
    return { buffer: wav, mimeType: "audio/wav", ext: "wav" };
  }

  async callElevenLabs(text) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenVoiceId}`;
    const res = await axios.post(
      url,
      { text, model_id: this.elevenModel, output_format: "mp3_44100_128" },
      {
        timeout: this.timeoutMs,
        responseType: "arraybuffer",
        headers: { "xi-api-key": this.elevenApiKey, "Content-Type": "application/json" },
      }
    );
    return { buffer: Buffer.from(res.data), mimeType: "audio/mpeg", ext: "mp3" };
  }

  async callOpenAI(text) {
    const res = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      { model: this.openaiTtsModel, voice: this.openaiVoice, input: text, response_format: "mp3" },
      {
        timeout: this.timeoutMs,
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${this.openaiApiKey}`, "Content-Type": "application/json" },
      }
    );
    return { buffer: Buffer.from(res.data), mimeType: "audio/mpeg", ext: "mp3" };
  }
}

export const ttsProviderService = new TtsProviderService();
export { pcmToWav };
export default ttsProviderService;
