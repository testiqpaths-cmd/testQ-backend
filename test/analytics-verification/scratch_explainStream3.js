import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import TestAttempt from "../../src/models/testAttempt.model.js";

async function explainStream3() {
  await mongoose.connect(process.env.MONGO_URI);

  const explainAdmin = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
    .sort({ submittedAt: -1, updatedAt: -1 })
    .limit(100)
    .explain("executionStats");

  const stage = explainAdmin.executionStats?.executionStages;
  console.log("=== Execution Stats for Stream 3 ===");
  console.log(`Winning plan stage: ${stage?.stage}`);
  console.log(`Input stage: ${stage?.inputStage?.stage}`);
  console.log(`Total docs examined: ${explainAdmin.executionStats?.totalDocsExamined}`);
  console.log(`Total keys examined: ${explainAdmin.executionStats?.totalKeysExamined}`);
  console.log(`Index used: ${stage?.inputStage?.indexName || stage?.indexName}`);

  await mongoose.disconnect();
}

explainStream3();
