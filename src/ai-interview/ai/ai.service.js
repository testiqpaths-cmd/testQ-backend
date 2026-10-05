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
    this.geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash";
    this.openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 25000;
  }

  getApiKey() {
    return this.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
  }

  getOpenAiKey() {
    return this.openaiApiKey || process.env.OPENAI_API_KEY || null;
  }

  getPrimaryModel() {
    return this.geminiModel || process.env.GEMINI_MODEL || "gemini-3.5-flash";
  }

  getFallbackModels() {
    const primary = this.getPrimaryModel();
    return [
      primary,
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3-flash-preview",
    ].filter((m, i, arr) => arr.indexOf(m) === i && Boolean(m));
  }

  /**
   * Runs `fn(attempt)` with up to 2 retries on transient errors (503, 429, timeout)
   * using exponential backoff with jitter. Bails out immediately on hard quota limits.
   */
  async withRetry(fn, maxAttempts = 2) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const errMsg = err.response?.data?.error?.message || err.message || "";
        const isQuotaExhausted =
          status === 429 &&
          (err.response?.data?.error?.status === "RESOURCE_EXHAUSTED" ||
            /quota exceeded|free_tier_requests/i.test(errMsg));

        // When daily quota is exhausted on a model, retrying the same model is futile
        if (isQuotaExhausted) {
          throw err;
        }

        const retryable =
          status === 503 || status === 429 || err.code === "ECONNABORTED" || /timeout/i.test(errMsg);
        if (!retryable || attempt === maxAttempts) {
          throw err;
        }
        const backoffMs = 600 * attempt + Math.floor(Math.random() * 300);
        logger.warn(`AI request transient error (${status || err.code}), retrying attempt ${attempt + 1}/${maxAttempts} after ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastErr;
  }

  /**
   * Send a structured prompt to the LLM with strict JSON output.
   * Automatically attempts alternative models if the primary model is unavailable.
   * Returns the parsed object, or null so the caller uses its fallback.
   *
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userPrompt
   * @param {{ interviewId?: string, purpose?: string }} [params.meta]
   */
  async generateStructuredJson({ systemPrompt, userPrompt, meta = {} }) {
    const { interviewId = null, purpose = "other" } = meta;
    const geminiKey = this.getApiKey();

    if (geminiKey) {
      for (const model of this.getFallbackModels()) {
        try {
          const result = await this.withRetry((attempt) =>
            this.callGemini({ systemPrompt, userPrompt, interviewId, purpose, attempt, model })
          );
          if (result) return result;
        } catch (err) {
          logger.warn(`Gemini AI call with model '${model}' failed: ${err.message}. Trying next available fallback...`);
        }
      }
    }

    const openAiKey = this.getOpenAiKey();
    if (openAiKey) {
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
  async callGemini({ systemPrompt, userPrompt, interviewId, purpose, attempt = 1, model = null }) {
    const key = this.getApiKey();
    if (!key) throw new Error("GEMINI_API_KEY not configured");
    const activeModel = model || this.getPrimaryModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${key}`;

    const generationConfig = {
      temperature: 0.3,
      response_mime_type: "application/json",
      max_output_tokens: 2048,
    };

    // Fast-path: models with reasoning enabled consume tokens from max_output_tokens.
    // Disabling thinking budget on standard flash models ensures full JSON output without truncation.
    if (!activeModel.includes("lite")) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig,
    };

    const start = Date.now();
    try {
      let response;
      try {
        response = await axios.post(url, payload, {
          timeout: this.timeoutMs,
          headers: { "Content-Type": "application/json" },
        });
      } catch (postErr) {
        // If 400 invalid argument occurs due to thinkingConfig, retry without it
        if (postErr.response?.status === 400 && payload.generationConfig?.thinkingConfig) {
          delete payload.generationConfig.thinkingConfig;
          response = await axios.post(url, payload, {
            timeout: this.timeoutMs,
            headers: { "Content-Type": "application/json" },
          });
        } else {
          throw postErr;
        }
      }

      const usage = response.data?.usageMetadata || {};
      await logCall({
        interviewId,
        purpose,
        provider: "gemini",
        model: activeModel,
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
        model: activeModel,
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
      max_tokens: 600,
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

  /** Strip markdown fences and parse JSON; extracts valid JSON object if surrounded. */
  parseJsonSafe(raw) {
    if (!raw) return null;
    let clean = String(raw).trim();
    const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      clean = codeBlockMatch[1].trim();
    }
    try {
      return JSON.parse(clean);
    } catch {
      const firstBrace = clean.indexOf("{");
      const lastBrace = clean.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
        } catch {
          // ignore
        }
      }
      return null;
    }
  }
}

export const aiService = new AiService();
export default aiService;
