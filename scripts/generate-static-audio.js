import fs from "fs";
import path from "path";
import crypto from "crypto";
if (!globalThis.crypto) {
  globalThis.crypto = crypto;
}
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const AUDIO_SPECS = [
  {
    filename: "interview-welcome.mp3",
    text: "Welcome to TestQ! We're excited to learn about your skills and experience. Let's get started.",
  },
  {
    filename: "first-question.mp3",
    text: "Here is your first question.",
  },
  {
    filename: "here-is-the-question.mp3",
    text: "Here is your next question.",
  },
  {
    filename: "next-question.mp3",
    text: "Here is your next question.",
  },
  {
    filename: "take-your-time.mp3",
    text: "Take your time and think through your answer.",
  },
  {
    filename: "test-completed.mp3",
    text: "You've completed your TestQ interview. Thank you for your time. Your results will be displayed on the screen shortly.",
  },
  {
    filename: "results-ready.mp3",
    text: "Your interview results are ready. You can now review your performance and feedback.",
  },
];

const TARGET_DIRS = [
  "/home/developer/testQ/testQ-backend/public/audio",
  "/home/developer/testQ/testQ-frontend/public/audio",
];

async function generateClip(tts, spec) {
  return new Promise((resolve, reject) => {
    const { audioStream } = tts.toStream(spec.text);
    const chunks = [];
    audioStream.on("data", (chunk) => chunks.push(chunk));
    audioStream.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });
    audioStream.on("error", (err) => reject(err));
  });
}

async function run() {
  console.log("Initializing MsEdgeTTS with voice: en-IN-NeerjaNeural...");
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-IN-NeerjaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  for (const dir of TARGET_DIRS) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  for (const spec of AUDIO_SPECS) {
    console.log(`Generating ${spec.filename} -> "${spec.text}"...`);
    const buffer = await generateClip(tts, spec);
    console.log(`Generated ${spec.filename}: ${buffer.length} bytes`);

    for (const dir of TARGET_DIRS) {
      const targetPath = path.join(dir, spec.filename);
      fs.writeFileSync(targetPath, buffer);
      console.log(`  Saved to ${targetPath}`);
    }
  }

  tts.close();
  console.log("All audio clips generated and saved successfully!");
}

run().catch((err) => {
  console.error("Error generating audio:", err);
  process.exit(1);
});
