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

    this.edgeVoice = process.env.EDGE_TTS_VOICE || "en-US-JennyNeural";

    // Google Cloud's Text-to-Speech product — a separate, GA (non-preview)
    // API from the Gemini generateContent TTS above, with its own billing
    // and its own API key (a Gemini/AI-Studio key does NOT automatically
    // work here; the "Cloud Text-to-Speech API" must be enabled on a
    // billed Google Cloud project and the key allowed to call it).
    this.googleCloudApiKey =
      process.env.GOOGLE_CLOUD_TTS_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || null;
    this.googleCloudVoice = process.env.GOOGLE_CLOUD_TTS_VOICE || "en-US-Neural2-C";
    this.googleCloudLanguageCode = process.env.GOOGLE_CLOUD_TTS_LANGUAGE || "en-US";
  }

  #hasValidKey(key) {
    return Boolean(key && String(key).trim() && !String(key).toLowerCase().includes("your-key-here"));
  }

  getEffectiveProvider() {
    if (this.provider === "edge" || this.provider === "msedge") return "edge";
    if (this.provider === "google-translate") return "google-translate";
    if (this.provider === "gemini" && this.#hasValidKey(this.geminiApiKey)) return "gemini";
    if (this.provider === "elevenlabs" && this.#hasValidKey(this.elevenApiKey)) return "elevenlabs";
    if (this.provider === "openai" && this.#hasValidKey(this.openaiApiKey)) return "openai";
    if ((this.provider === "google-cloud" || this.provider === "google") && this.#hasValidKey(this.googleCloudApiKey)) {
      return "google-cloud";
    }
    if (this.#hasValidKey(this.geminiApiKey)) return "gemini";
    // Default reliable zero-key provider
    return "edge";
  }

  isEnabled() {
    if (!this.enabled) return false;
    return Boolean(this.getEffectiveProvider());
  }

  /** @returns {{voice:string, model:string, provider:string}} for cache keys */
  descriptor() {
    const eff = this.getEffectiveProvider() || this.provider;
    if (eff === "edge" || eff === "msedge") {
      return { provider: "edge", model: "azure-neural", voice: this.edgeVoice };
    }
    if (eff === "google-translate") {
      return { provider: "google-translate", model: "tw-ob", voice: "en" };
    }
    if (eff === "elevenlabs") {
      return { provider: "elevenlabs", model: this.elevenModel, voice: this.elevenVoiceId };
    }
    if (eff === "openai") {
      return { provider: "openai", model: this.openaiTtsModel, voice: this.openaiVoice };
    }
    if (eff === "google-cloud" || eff === "google") {
      return { provider: "google-cloud", model: this.googleCloudVoice, voice: this.googleCloudVoice };
    }
    return { provider: "gemini", model: this.geminiModel, voice: this.geminiVoice };
  }

  async #dispatch(text, provider = null) {
    const target = provider || this.getEffectiveProvider() || this.provider;
    if (target === "edge" || target === "msedge") return this.callEdge(text);
    if (target === "google-translate") return this.callGoogleTranslate(text);
    if (target === "elevenlabs") return this.callElevenLabs(text);
    if (target === "openai") return this.callOpenAI(text);
    if (target === "google-cloud" || target === "google") {
      return this.callGoogleCloud(text);
    }
    return this.callGemini(text);
  }

  async synthesize(text, { interviewId = null } = {}) {
    if (!this.isEnabled() || !text || !String(text).trim()) return null;
    const effProvider = this.getEffectiveProvider();
    const start = Date.now();
    try {
      let out = null;
      try {
        out = await this.#dispatch(text, effProvider);
      } catch (err) {
        logger.warn(`TTS (${effProvider}) primary call failed: ${err.message}. Engaging resilient fallback cascade...`);
        if (effProvider !== "edge") {
          try {
            out = await this.callEdge(text);
          } catch (edgeErr) {
            logger.warn(`Edge TTS fallback also failed: ${edgeErr.message}. Trying Google Translate TTS...`);
            try {
              out = await this.callGoogleTranslate(text);
            } catch (gtErr) {
              logger.warn(`Google Translate TTS fallback failed: ${gtErr.message}`);
              throw err;
            }
          }
        } else {
          try {
            out = await this.callGoogleTranslate(text);
          } catch (gtErr) {
            logger.warn(`Google Translate TTS fallback failed: ${gtErr.message}`);
            throw err;
          }
        }
      }

      await logCall({
        interviewId,
        provider: effProvider,
        model: this.descriptor().model,
        latencyMs: Date.now() - start,
        status: out ? "success" : "error",
      });
      return out;
    } catch (err) {
      await logCall({
        interviewId,
        provider: effProvider,
        model: this.descriptor().model,
        latencyMs: Date.now() - start,
        status: err.response?.status === 429 ? "rate_limited" : "error",
        httpStatus: err.response?.status ?? null,
        errorMessage: (err.message || "").slice(0, 300),
      });
      logger.warn(`TTS (${effProvider}) failed (non-fatal): ${err.message}`);
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

  /** Google Cloud Text-to-Speech (GA, not a preview model) — Neural2 voice. */
  async callGoogleCloud(text) {
    let url = "https://texttospeech.googleapis.com/v1/text:synthesize";
    const headers = { "Content-Type": "application/json" };

    if (this.googleCloudApiKey && !this.googleCloudApiKey.includes("your-key-here")) {
      url += `?key=${this.googleCloudApiKey}`;
    } else {
      try {
        const { GoogleAuth } = await import("google-auth-library");
        const auth = new GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (token?.token) {
          headers["Authorization"] = `Bearer ${token.token}`;
        }
      } catch (authErr) {
        logger.warn(`GoogleAuth token retrieval failed: ${authErr.message}`);
      }
    }

    const res = await axios.post(
      url,
      {
        input: { text },
        voice: { languageCode: this.googleCloudLanguageCode, name: this.googleCloudVoice },
        audioConfig: { audioEncoding: "MP3" },
      },
      { timeout: this.timeoutMs, headers }
    );
    const b64 = res.data?.audioContent;
    if (!b64) return null;
    return { buffer: Buffer.from(b64, "base64"), mimeType: "audio/mpeg", ext: "mp3" };
  }

  /** Microsoft Azure Neural TTS via Read Aloud API (Free, high-fidelity neural voice, no key required). */
  async callEdge(text) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    return new Promise((resolve, reject) => {
      const tts = new MsEdgeTTS();
      const timer = setTimeout(() => {
        try {
          tts.close();
        } catch {}
        reject(new Error("Edge TTS timed out"));
      }, this.timeoutMs || 12000);

      tts
        .setMetadata(this.edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
        .then(() => {
          const { audioStream } = tts.toStream(text);
          const chunks = [];
          audioStream.on("data", (chunk) => chunks.push(chunk));
          audioStream.on("end", () => {
            clearTimeout(timer);
            try {
              tts.close();
            } catch {}
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) {
              reject(new Error("Edge TTS returned empty buffer"));
              return;
            }
            resolve({ buffer, mimeType: "audio/mpeg", ext: "mp3" });
          });
          audioStream.on("error", (err) => {
            clearTimeout(timer);
            try {
              tts.close();
            } catch {}
            reject(err);
          });
        })
        .catch((err) => {
          clearTimeout(timer);
          try {
            tts.close();
          } catch {}
          reject(err);
        });
    });
  }

  /** Fast fallback via Google Translate TTS (Zero config, immediate ~200ms audio/mpeg). */
  async callGoogleTranslate(text) {
    const cleanText = String(text || "").slice(0, 250);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 6000,
    });
    return { buffer: Buffer.from(res.data), mimeType: "audio/mpeg", ext: "mp3" };
  }
}

export const ttsProviderService = new TtsProviderService();
export { pcmToWav };
export default ttsProviderService;
