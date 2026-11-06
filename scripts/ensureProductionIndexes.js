import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import Subject from "../src/models/subject.model.js";
import Topic from "../src/models/topic.model.js";
import TestAttempt from "../src/models/testAttempt.model.js";
import TestAssignment from "../src/models/testAssignment.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import DailyStudentActivity from "../src/models/dailyStudentActivity.model.js";
import PlatformDailySummary from "../src/models/platformDailySummary.model.js";
import AnalyticsProcessingRecord from "../src/models/analyticsProcessingRecord.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

/**
 * Controlled index migration script.
 * 
 * Safely creates all required schema indexes using createIndexes() (non-destructive).
 * Does NOT drop indexes managed outside Mongoose unless --force-sync is explicitly provided.
 */
async function ensureProductionIndexes() {
  const isForceSync = process.argv.includes("--force-sync");

  console.log("==================================================================");
  console.log(`CONTROLLED PRODUCTION INDEX MANAGEMENT (Mode: ${isForceSync ? "FORCE-SYNC (destructive)" : "SAFE CREATE (non-destructive)"})`);
  console.log("==================================================================");

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.\n");

  const models = [
    { name: "Subject", model: Subject },
    { name: "Topic", model: Topic },
    { name: "TestAttempt", model: TestAttempt },
    { name: "TestAssignment", model: TestAssignment },
    { name: "StudentPerformanceSummary", model: StudentPerformanceSummary },
    { name: "DailyStudentActivity", model: DailyStudentActivity },
    { name: "PlatformDailySummary", model: PlatformDailySummary },
    { name: "AnalyticsProcessingRecord", model: AnalyticsProcessingRecord },
  ];

  try {
    for (const { name, model } of models) {
      console.log(`Processing indexes for collection [${name}]...`);

      if (isForceSync) {
        // Warning: This drops unmanaged indexes!
        const result = await model.syncIndexes();
        console.log(`  syncIndexes result:`, result);
      } else {
        // Safe: creates missing indexes defined in schema, does NOT drop any existing indexes
        await model.createIndexes();
        const existingIndexes = await model.collection.indexes();
        console.log(`  Active indexes (${existingIndexes.length}):`);
        existingIndexes.forEach((idx) => {
          const keys = Object.entries(idx.key)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          console.log(`    - ${idx.name} ({ ${keys} })`);
        });
      }
    }

    console.log("\n==================================================================");
    console.log("ALL PRODUCTION INDEXES SAFELY VERIFIED & SYNCHRONIZED!");
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Failed to ensure production indexes:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

ensureProductionIndexes();
