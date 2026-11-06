import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

async function run() {
  const conn = await mongoose.connect(process.env.MONGO_URI);
  const db = conn.connection.db;
  const attempts = await db.collection("testattempts").find({ 
    status: { $in: ["SUBMITTED", "EVALUATED"] } 
  }).toArray();

  let affectedAttempts = 0;
  let totalDiscrepancyQuestions = 0;

  for (const a of attempts) {
    const answers = a.answers || [];
    const correctQ = answers.filter((ans) => ans.isCorrect === true).length;
    const answeredWrongQ = answers.filter((ans) => ans.isCorrect === false && (
      (ans.selectedOption !== undefined && ans.selectedOption !== null && ans.selectedOption !== "") ||
      (ans.textAnswer !== undefined && ans.textAnswer !== null && String(ans.textAnswer).trim() !== "")
    )).length;
    const trueAttempted = correctQ + answeredWrongQ;
    const storedAttempted = (a.correctAnswersCount || 0) + (a.incorrectAnswersCount || 0);

    if (trueAttempted !== storedAttempted) {
      affectedAttempts++;
      totalDiscrepancyQuestions += Math.abs(storedAttempted - trueAttempted);
    }
  }

  console.log(`Total eligible attempts: ${attempts.length}`);
  console.log(`Affected attempts with inflated incorrect count: ${affectedAttempts}`);
  console.log(`Total phantom incorrect answers: ${totalDiscrepancyQuestions}`);

  await mongoose.disconnect();
}
run();
