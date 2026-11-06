import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import { processCompletedAttemptAnalytics } from "../src/services/analyticsSummary.service.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!mongoUri) {
  console.error("❌ Error: MONGODB_URI or MONGO_URI must be set in environment or .env file.");
  process.exit(1);
}

const batchSize = parseInt(process.env.ANALYTICS_BACKFILL_BATCH_SIZE || "100", 10);

async function runBackfill() {
  const startTime = Date.now();
  console.log("=================================================");
  console.log("🚀 Starting Analytics Summaries Backfill");
  console.log(`📦 Batch size: ${batchSize}`);
  console.log("=================================================");

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB.");

    const eligibleQuery = { status: { $in: ["SUBMITTED", "EVALUATED"] } };
    const totalEligible = await TestAttempt.countDocuments(eligibleQuery);
    console.log(`📊 Total eligible attempts found: ${totalEligible}`);

    if (totalEligible === 0) {
      console.log("No eligible attempts to process. Exiting.");
      await mongoose.disconnect();
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let cursor = 0;

    // Process attempts sorted chronologically so daily aggregates and active-student deduplication reflect actual order
    const eligibleAttempts = await TestAttempt.find(eligibleQuery)
      .select("_id submittedAt status")
      .sort({ submittedAt: 1, updatedAt: 1, createdAt: 1 })
      .lean();

    for (let i = 0; i < eligibleAttempts.length; i += batchSize) {
      const batch = eligibleAttempts.slice(i, i + batchSize);

      for (const attempt of batch) {
        try {
          const res = await processCompletedAttemptAnalytics(attempt._id);
          if (res?.skipped) {
            skippedCount++;
          } else if (res?.success) {
            processedCount++;
          } else {
            failedCount++;
            console.warn(`⚠️ Attempt ${attempt._id} not processed: ${res?.reason}`);
          }
        } catch (attemptErr) {
          failedCount++;
          console.error(`❌ Failed processing attempt ${attempt._id}:`, attemptErr.message);
        }
      }

      cursor += batch.length;
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const percentage = ((cursor / totalEligible) * 100).toFixed(1);
      console.log(
        `⏳ [Progress] ${cursor}/${totalEligible} (${percentage}%) | ` +
        `Processed: ${processedCount} | Skipped: ${skippedCount} | Failed: ${failedCount} | Elapsed: ${elapsedSec}s`
      );
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("=================================================");
    console.log("🎉 Backfill Completed Successfully!");
    console.log(`⏱️ Total Duration: ${totalDuration}s`);
    console.log(`✅ Newly Processed: ${processedCount}`);
    console.log(`⏭️ Skipped (Already Processed / Ineligible): ${skippedCount}`);
    console.log(`❌ Failed: ${failedCount}`);
    console.log("=================================================");
  } catch (err) {
    console.error("❌ Fatal error during backfill:", err);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
      console.log("Disconnected from MongoDB.");
    } catch {
      // Ignore disconnect errors
    }
  }
}

runBackfill();
