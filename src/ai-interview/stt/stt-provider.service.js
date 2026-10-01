import axios from "axios";
import { AiCallLog } from "../schemas/ai-call-log.schema.js";
import logger from "../../config/logger.js";

async function logCall(row) {
  try {
    await AiCallLog.create({ ...row, purpose: "stt" });
  } catch (err) {
    logger.warn(`AiCallLog (stt) write failed (non-fatal): ${err.message}`);
  }
}

/** Map a recorded clip's mimetype to a Google Cloud STT encoding value. */
function googleSttEncoding(mimeType) {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("webm")) return "WEBM_OPUS"; // MediaRecorder's browser default
  if (m.includes("ogg")) return "OGG_OPUS";
  if (m.includes("flac")) return "FLAC";
  if (m.includes("wav")) return "LINEAR16";
  if (m.includes("mp3") || m.includes("mpeg")) return "MP3";
  return null; // let Google infer it from the container where it can (WAV/FLAC)
}

/**
 * Provider-agnostic speech-to-text. Gemini is the default (multimodal
 * transcription via generateContent); OpenAI (whisper) and Deepgram are
 * wired but inert until their keys are set.
 *
 * This is a server-side ALTERNATIVE to the browser's SpeechRecognition
 * (useSpeechToText.js), for browsers without it or to capture an
 * authoritative transcript. Disabled unless a usable provider is
 * configured; the kill switch is AI_INTERVIEW_STT_ENABLED=false.
 *
 * transcribe() resolves to { text, provider, model } or null.
 */
export class SttProviderService {
  constructor() {
    this.provider = (process.env.AI_INTERVIEW_STT_PROVIDER || "gemini").toLowerCase();
    this.killed = String(process.env.AI_INTERVIEW_STT_ENABLED || "true").toLowerCase() === "false";
    this.timeoutMs = Number(process.env.AI_STT_TIMEOUT_MS) || 45000;

    this.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
    // A multimodal flash model — inline audio + "transcribe" instruction.
    this.geminiModel = process.env.GEMINI_STT_MODEL || "gemini-3.6-flash";

    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
    this.openaiModel = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";

    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY || null;
    this.deepgramModel = process.env.DEEPGRAM_STT_MODEL || "nova-2";

    // Google Cloud's Speech-to-Text product — a separate, GA API from the
    // Gemini multimodal-transcription approach above, with its own billing
    // and its own API key (enable "Cloud Speech-to-Text API" on a billed
    // Google Cloud project; a Gemini/AI-Studio key won't work here as-is).
    this.googleCloudApiKey =
      process.env.GOOGLE_CLOUD_STT_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || null;
    this.googleCloudLanguageCode = process.env.GOOGLE_CLOUD_STT_LANGUAGE || "en-US";
  }

  #hasValidKey(key) {
    return Boolean(key && String(key).trim() && !String(key).toLowerCase().includes("your-key-here"));
  }

  getEffectiveProvider() {
    if (this.provider === "gemini" && this.#hasValidKey(this.geminiApiKey)) return "gemini";
    if (this.provider === "openai" && this.#hasValidKey(this.openaiApiKey)) return "openai";
    if (this.provider === "deepgram" && this.#hasValidKey(this.deepgramApiKey)) return "deepgram";
    if ((this.provider === "google-cloud" || this.provider === "google") && this.#hasValidKey(this.googleCloudApiKey)) {
      return "google-cloud";
    }
    // Fall back to Gemini if configured provider key is missing/placeholder
    if (this.#hasValidKey(this.geminiApiKey)) return "gemini";
    return null;
  }

  isEnabled() {
    if (this.killed) return false;
    return Boolean(this.getEffectiveProvider());
  }

  model() {
    const eff = this.getEffectiveProvider() || this.provider;
    if (eff === "openai") return this.openaiModel;
    if (eff === "deepgram") return this.deepgramModel;
    if (eff === "google-cloud" || eff === "google") return "google-cloud-speech-v1";
    return this.geminiModel;
  }

  async transcribe(buffer, mimeType, { interviewId = null } = {}) {
    if (!this.isEnabled() || !buffer?.length) return null;
    const effProvider = this.getEffectiveProvider();
    const start = Date.now();
    try {
      let text = null;
      try {
        if (effProvider === "openai") text = await this.callOpenAI(buffer, mimeType);
        else if (effProvider === "deepgram") text = await this.callDeepgram(buffer, mimeType);
        else if (effProvider === "google-cloud" || effProvider === "google") {
          text = await this.callGoogleCloud(buffer, mimeType);
        } else text = await this.callGemini(buffer, mimeType);
      } catch (err) {
        if (effProvider !== "gemini" && this.#hasValidKey(this.geminiApiKey)) {
          logger.warn(`STT (${effProvider}) failed: ${err.message}. Retrying with Gemini STT fallback.`);
          text = await this.callGemini(buffer, mimeType);
        } else {
          throw err;
        }
      }

      text = (text || "").trim();
      await logCall({
        interviewId,
        provider: effProvider,
        model: this.model(),
        latencyMs: Date.now() - start,
        status: text ? "success" : "error",
      });
      return text ? { text, provider: effProvider, model: this.model() } : null;
    } catch (err) {
      await logCall({
        interviewId,
        provider: effProvider,
        model: this.model(),
        latencyMs: Date.now() - start,
        status: err.response?.status === 429 ? "rate_limited" : "error",
        httpStatus: err.response?.status ?? null,
        errorMessage: (err.message || "").slice(0, 300),
      });
      logger.warn(`STT (${effProvider}) failed (non-fatal): ${err.message}`);
      return null;
    }
  }

  async callGemini(buffer, mimeType) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const res = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mimeType || "audio/wav", data: buffer.toString("base64") } },
              {
                text: "Transcribe this audio verbatim. Return ONLY the transcript text with no preamble, quotes, or commentary. If there is no intelligible speech, return an empty string.",
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      },
      { timeout: this.timeoutMs, headers: { "Content-Type": "application/json" } }
    );
    return (res.data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join(" ");
  }

  async callOpenAI(buffer, mimeType) {
    const { default: FormData } = await import("form-data");
    const form = new FormData();
    form.append("file", buffer, { filename: `audio.${(mimeType || "audio/wav").split("/")[1] || "wav"}` });
    form.append("model", this.openaiModel);
    form.append("response_format", "text");
    const res = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
      timeout: this.timeoutMs,
      headers: { ...form.getHeaders(), Authorization: `Bearer ${this.openaiApiKey}` },
      maxBodyLength: Infinity,
    });
    return typeof res.data === "string" ? res.data : res.data?.text || "";
  }

  async callDeepgram(buffer, mimeType) {
    const res = await axios.post(
      `https://api.deepgram.com/v1/listen?model=${this.deepgramModel}&smart_format=true&punctuate=true`,
      buffer,
      {
        timeout: this.timeoutMs,
        headers: {
          Authorization: `Token ${this.deepgramApiKey}`,
          "Content-Type": mimeType || "audio/wav",
        },
        maxBodyLength: Infinity,
      }
    );
    return res.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  }

  /**
   * Google Cloud Speech-to-Text (GA v1, synchronous recognize) — fine for
   * short interview-answer clips (this endpoint caps at ~1 minute audio).
   */
  async callGoogleCloud(buffer, mimeType) {
    const encoding = googleSttEncoding(mimeType);
    const config = { languageCode: this.googleCloudLanguageCode, enableAutomaticPunctuation: true };
    if (encoding) config.encoding = encoding; // omitted -> Google infers from WAV/FLAC headers

    const res = await axios.post(
      `https://speech.googleapis.com/v1/speech:recognize?key=${this.googleCloudApiKey}`,
      { config, audio: { content: buffer.toString("base64") } },
      { timeout: this.timeoutMs, headers: { "Content-Type": "application/json" }, maxBodyLength: Infinity }
    );
    return (res.data?.results || [])
      .map((r) => r.alternatives?.[0]?.transcript)
      .filter(Boolean)
      .join(" ");
  }
}

export const sttProviderService = new SttProviderService();
export default sttProviderService;
