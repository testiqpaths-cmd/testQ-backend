import axios from "axios";
import { AiCallLog } from "../schemas/ai-call-log.schema.js";
import logger from "../../config/logger.js";

/** Never let call-logging break the interview flow. */
async function logCall(row) {
  try {
    await AiCallLog.create(row);
  } catch (err) {
    logger.warn(`AiCallLog write failed (non-fatal): ${err.message}`);
  }
}

function classifyError(err) {
  const httpStatus = err.response?.status ?? null;
  if (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")) return { status: "timeout", httpStatus };
  if (httpStatus === 429) return { status: "rate_limited", httpStatus };
  if (httpStatus === 503) return { status: "unavailable", httpStatus };
  return { status: "error", httpStatus };
}

export class AiService {
  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
    // "gemini-flash-latest" tracks Google's current stable flash model, so
    // this doesn't break again when a specific version is retired (as
    // gemini-1.5-flash was). Pin a version via GEMINI_MODEL if needed.
    this.geminiModel = process.env.GEMINI_MODEL || "gemini-flash-latest";
    this.openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    // Current-gen flash models routinely need >6s for a full structured-JSON
    // response; 6s timed out almost every call. Override with AI_TIMEOUT_MS.
    this.timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 15000;
  }

  /**
   * Runs `fn(attempt)` once, then once more on a transient error (503, 429,
   * timeout). Each attempt is logged to AiCallLog via `fn` itself.
   */
  async withRetry(fn) {
    try {
      return await fn(1);
    } catch (err) {
      const status = err.response?.status;
      const retryable =
        status === 503 || status === 429 || err.code === "ECONNABORTED" || /timeout/i.test(err.message || "");
      if (!retryable) throw err;
      await new Promise((r) => setTimeout(r, 800));
      return fn(2);
    }
  }

  /**
   * Send a structured prompt to the LLM with strict JSON output.
   * Returns the parsed object, or null so the caller uses its fallback.
   *
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userPrompt
   * @param {{ interviewId?: string, purpose?: string }} [params.meta]
   */
  async generateStructuredJson({ systemPrompt, userPrompt, meta = {} }) {
    const { interviewId = null, purpose = "other" } = meta;

    if (this.geminiApiKey) {
      try {
        return await this.withRetry((attempt) =>
          this.callGemini({ systemPrompt, userPrompt, interviewId, purpose, attempt })
        );
      } catch (err) {
        logger.warn(`Gemini AI call failed: ${err.message}. Triggering fallback.`);
      }
    }

    if (this.openaiApiKey) {
      try {
        return await this.withRetry((attempt) =>
          this.callOpenAI({ systemPrompt, userPrompt, interviewId, purpose, attempt })
        );
      } catch (err) {
        logger.warn(`OpenAI call failed: ${err.message}. Triggering fallback.`);
      }
    }

    return null;
  }

  /** Gemini generateContent with strict timeout + JSON response mode. */
  async callGemini({ systemPrompt, userPrompt, interviewId, purpose, attempt = 1 }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.3, response_mime_type: "application/json" },
    };

    const start = Date.now();
    try {
      const response = await axios.post(url, payload, {
        timeout: this.timeoutMs,
        headers: { "Content-Type": "application/json" },
      });
      const usage = response.data?.usageMetadata || {};
      await logCall({
        interviewId,
        purpose,
        provider: "gemini",
        model: this.geminiModel,
        tokensIn: usage.promptTokenCount ?? null,
        tokensOut: usage.candidatesTokenCount ?? null,
        latencyMs: Date.now() - start,
        attempt,
        status: "success",
      });
      return this.parseJsonSafe(response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
    } catch (err) {
      const { status, httpStatus } = classifyError(err);
      await logCall({
        interviewId,
        purpose,
        provider: "gemini",
        model: this.geminiModel,
        latencyMs: Date.now() - start,
        attempt,
        status,
        httpStatus,
        errorMessage: (err.message || "").slice(0, 300),
      });
      throw err;
    }
  }

  /** OpenAI chat.completions with strict timeout + json_object response. */
  async callOpenAI({ systemPrompt, userPrompt, interviewId, purpose, attempt = 1 }) {
    const url = "https://api.openai.com/v1/chat/completions";
    const payload = {
      model: this.openaiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    };

    const start = Date.now();
    try {
      const response = await axios.post(url, payload, {
        timeout: this.timeoutMs,
        headers: { Authorization: `Bearer ${this.openaiApiKey}`, "Content-Type": "application/json" },
      });
      const usage = response.data?.usage || {};
      await logCall({
        interviewId,
        purpose,
        provider: "openai",
        model: this.openaiModel,
        tokensIn: usage.prompt_tokens ?? null,
        tokensOut: usage.completion_tokens ?? null,
        latencyMs: Date.now() - start,
        attempt,
        status: "success",
      });
      return this.parseJsonSafe(response.data?.choices?.[0]?.message?.content || "");
    } catch (err) {
      const { status, httpStatus } = classifyError(err);
      await logCall({
        interviewId,
        purpose,
        provider: "openai",
        model: this.openaiModel,
        latencyMs: Date.now() - start,
        attempt,
        status,
        httpStatus,
        errorMessage: (err.message || "").slice(0, 300),
      });
      throw err;
    }
  }

  /**
   * Embeds text with Gemini's embedding model. Returns a number[] or null.
   * Also logged to AiCallLog (purpose "embedding").
   */
  async embed(text, { interviewId = null } = {}) {
    if (!this.geminiApiKey || !text) return null;
    // "text-embedding-004" was retired the same way the 1.5 chat models
    // were; "gemini-embedding-001" is the current stable embedder. It
    // defaults to 3072 dims — truncate to 768 (Matryoshka) to keep stored
    // vectors small; cosine similarity is scale-invariant so no re-norm.
    const model = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
    const dim = Number(process.env.GEMINI_EMBED_DIM) || 768;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.geminiApiKey}`;
    const start = Date.now();
    try {
      const response = await axios.post(
        url,
        {
          model: `models/${model}`,
          content: { parts: [{ text: String(text).slice(0, 8000) }] },
          outputDimensionality: dim,
        },
        { timeout: this.timeoutMs, headers: { "Content-Type": "application/json" } }
      );
      const vector = response.data?.embedding?.values || null;
      await logCall({
        interviewId,
        purpose: "embedding",
        provider: "gemini",
        model,
        latencyMs: Date.now() - start,
        status: vector ? "success" : "error",
      });
      return Array.isArray(vector) ? vector : null;
    } catch (err) {
      const { status, httpStatus } = classifyError(err);
      await logCall({
        interviewId,
        purpose: "embedding",
        provider: "gemini",
        model,
        latencyMs: Date.now() - start,
        status,
        httpStatus,
        errorMessage: (err.message || "").slice(0, 300),
      });
      return null;
    }
  }

  /** Strip markdown fences and parse JSON; null on failure. */
  parseJsonSafe(raw) {
    if (!raw) return null;
    let clean = raw.trim();
    if (clean.startsWith("```json")) {
      clean = clean.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (clean.startsWith("```")) {
      clean = clean.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    try {
      return JSON.parse(clean);
    } catch {
      return null;
    }
  }
}

export const aiService = new AiService();
export default aiService;
