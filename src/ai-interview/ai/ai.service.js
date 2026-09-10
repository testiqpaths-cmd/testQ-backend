import axios from "axios";
import logger from "../../config/logger.js";

export class AiService {
  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
    this.timeoutMs = 6000; // 6-second strict timeout for interview responsiveness
  }

  /**
   * Send a structured prompt to the configured LLM with strict JSON output format.
   * If external AI is unavailable or fails, returns null so the caller uses fallback.
   *
   * @param {Object} params
   * @param {string} params.systemPrompt - Role and formatting instructions
   * @param {string} params.userPrompt - Context and task description
   * @returns {Promise<Object|null>} Parsed JSON response or null
   */
  async generateStructuredJson({ systemPrompt, userPrompt }) {
    // 1. Try Gemini if configured
    if (this.geminiApiKey) {
      try {
        return await this.callGemini({ systemPrompt, userPrompt });
      } catch (err) {
        logger.warn(`Gemini AI call failed: ${err.message}. Triggering fallback.`);
      }
    }

    // 2. Try OpenAI if configured
    if (this.openaiApiKey) {
      try {
        return await this.callOpenAI({ systemPrompt, userPrompt });
      } catch (err) {
        logger.warn(`OpenAI call failed: ${err.message}. Triggering fallback.`);
      }
    }

    // If no LLM key configured or both failed, return null to activate fallback engine
    return null;
  }

  /**
   * Gemini API call with strict timeout and JSON response mode
   */
  async callGemini({ systemPrompt, userPrompt }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        response_mime_type: "application/json",
      },
    };

    const response = await axios.post(url, payload, {
      timeout: this.timeoutMs,
      headers: { "Content-Type": "application/json" },
    });

    const text =
      response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return this.parseJsonSafe(text);
  }

  /**
   * OpenAI API call with strict timeout and JSON object response format
   */
  async callOpenAI({ systemPrompt, userPrompt }) {
    const url = "https://api.openai.com/v1/chat/completions";

    const payload = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    };

    const response = await axios.post(url, payload, {
      timeout: this.timeoutMs,
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
    });

    const content = response.data?.choices?.[0]?.message?.content || "";
    return this.parseJsonSafe(content);
  }

  /**
   * Safely strip markdown formatting and parse JSON
   */
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
