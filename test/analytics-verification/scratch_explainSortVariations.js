import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import TestAttempt from "../../src/models/testAttempt.model.js";

async function explainSortVariations() {
  await mongoose.connect(process.env.MONGO_URI);

  const explainSortSubmittedAtOnly = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
    .sort({ submittedAt: -1 })
    .limit(100)
    .explain("executionStats");

  const stage = explainSortSubmittedAtOnly.executionStats?.executionStages;
  console.log("=== Execution Stats with sort({ submittedAt: -1 }) only ===");
  console.log(`Winning plan stage: ${stage?.stage}`);
  console.log(`Input stage: ${stage?.inputStage?.stage}`);
  console.log(`Total docs examined: ${explainSortSubmittedAtOnly.executionStats?.totalDocsExamined}`);
  console.log(`Index used: ${stage?.inputStage?.indexName || stage?.indexName}`);

  await mongoose.disconnect();
}

explainSortVariations();
