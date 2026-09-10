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
  }

  isEnabled() {
    if (this.killed) return false;
    if (this.provider === "gemini") return Boolean(this.geminiApiKey);
    if (this.provider === "openai") return Boolean(this.openaiApiKey);
    if (this.provider === "deepgram") return Boolean(this.deepgramApiKey);
    return false;
  }

  model() {
    if (this.provider === "openai") return this.openaiModel;
    if (this.provider === "deepgram") return this.deepgramModel;
    return this.geminiModel;
  }

  async transcribe(buffer, mimeType, { interviewId = null } = {}) {
    if (!this.isEnabled() || !buffer?.length) return null;
    const start = Date.now();
    try {
      let text = null;
      if (this.provider === "openai") text = await this.callOpenAI(buffer, mimeType);
      else if (this.provider === "deepgram") text = await this.callDeepgram(buffer, mimeType);
      else text = await this.callGemini(buffer, mimeType);

      text = (text || "").trim();
      await logCall({
        interviewId,
        provider: this.provider,
        model: this.model(),
        latencyMs: Date.now() - start,
        status: text ? "success" : "error",
      });
      return text ? { text, provider: this.provider, model: this.model() } : null;
    } catch (err) {
      await logCall({
        interviewId,
        provider: this.provider,
        model: this.model(),
        latencyMs: Date.now() - start,
        status: err.response?.status === 429 ? "rate_limited" : "error",
        httpStatus: err.response?.status ?? null,
        errorMessage: (err.message || "").slice(0, 300),
      });
      logger.warn(`STT (${this.provider}) failed (non-fatal): ${err.message}`);
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
}

export const sttProviderService = new SttProviderService();
export default sttProviderService;
