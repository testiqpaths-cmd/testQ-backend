import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const audioDir = path.join(process.cwd(), "public/audio");

const EXPECTED_TEXTS = {
  "interview-welcome.mp3": "Welcome to TestQ! We're excited to learn about your skills and experience. Let's get started.",
  "first-question.mp3": "Here is your first question.",
  "here-is-the-question.mp3": "Here is your next question.",
  "next-question.mp3": "Here is your next question.",
  "take-your-time.mp3": "Take your time and think through your answer.",
  "test-completed.mp3": "You've completed your TestQ interview. Thank you for your time. Your results will be displayed on the screen shortly.",
  "results-ready.mp3": "Your interview results are ready. You can now review your performance and feedback.",
};

async function transcribeAudio(filePath) {
  const audioBuffer = fs.readFileSync(filePath);
  const base64Audio = audioBuffer.toString("base64");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            text: "Listen to this audio clip and transcribe the exact words spoken verbatim. Output ONLY the transcription, without any preamble, quotation marks, or extra comments.",
          },
          {
            inlineData: {
              mimeType: "audio/mp3",
              data: base64Audio,
            },
          },
        ],
      },
    ],
  };

  const response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return text;
}

async function verifyAll() {
  console.log("=== Verifying Spoken Audio Files ===");
  let allMatched = true;

  for (const [filename, expected] of Object.entries(EXPECTED_TEXTS)) {
    const filePath = path.join(audioDir, filename);
    if (!fs.existsSync(filePath)) {
      console.error(`File missing: ${filename}`);
      allMatched = false;
      continue;
    }

    try {
      const transcription = await transcribeAudio(filePath);
      console.log(`\nFile: ${filename}`);
      console.log(`Expected:      "${expected}"`);
      console.log(`Transcribed:   "${transcription}"`);

      const cleanExpected = expected.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      const cleanTranscribed = transcription.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

      if (cleanExpected === cleanTranscribed) {
        console.log(`Status:        MATCH (100%)`);
      } else {
        console.warn(`Status:        MISMATCH!`);
        allMatched = false;
      }
    } catch (err) {
      console.error(`Transcription error for ${filename}:`, err.response?.data || err.message);
      allMatched = false;
    }
  }

  if (allMatched) {
    console.log("\nALL AUDIO FILES VERIFIED AND MATCH EXPECTED TEXT EXACTLY!");
  } else {
    console.error("\nSome files did not match or failed verification.");
    process.exit(1);
  }
}

verifyAll();
