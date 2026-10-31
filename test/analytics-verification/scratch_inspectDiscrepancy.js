import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

async function run() {
  const conn = await mongoose.connect(process.env.MONGO_URI);
  const db = conn.connection.db;
  const studentId = new mongoose.Types.ObjectId("6a58fcec24446ef390bf4cf5");
  const attempts = await db.collection("testattempts").find({ 
    studentId, 
    status: { $in: ["SUBMITTED", "EVALUATED"] } 
  }).toArray();

  for (const a of attempts) {
    const answers = a.answers || [];
    const correctQ = answers.filter((ans) => ans.isCorrect).length;
    const wrongQ = answers.filter((ans) => !ans.isCorrect && ans.selectedOption).length;
    const attemptedQ = correctQ + wrongQ;
    const storedAttempted = (a.correctAnswersCount || 0) + (a.incorrectAnswersCount || 0);
    
    if (attemptedQ !== storedAttempted) {
      console.log("Mismatch on attempt:", a._id);
      console.log("answers filter:", { correctQ, wrongQ, attemptedQ });
      console.log("stored stats:", {
        correctAnswersCount: a.correctAnswersCount,
        incorrectAnswersCount: a.incorrectAnswersCount,
        unattemptedCount: a.unattemptedCount,
        storedAttempted
      });
      console.log("answers:", answers.map(ans => ({
        selectedOption: ans.selectedOption,
        textAnswer: ans.textAnswer,
        isCorrect: ans.isCorrect
      })));
    }
  }

  await mongoose.disconnect();
}
run();
