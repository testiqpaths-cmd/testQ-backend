import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

import mongoose from "mongoose";
import dotenv from "dotenv";
import TestAttempt from "../src/models/testAttempt.model.js";
import Test from "../src/models/test.model.js";
import Topic from "../src/models/topic.model.js";
import Subject from "../src/models/subject.model.js";
import Question from "../src/models/question.model.js";
import {
  buildAttemptAnalyticsSnapshot,
  isValidSnapshot,
} from "../src/modules/test-attempts/utils/attemptAnalyticsSnapshot.util.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

export async function backfillAttemptSnapshots({ batchSize = 50, force = false } = {}) {
  const startTime = Date.now();
  console.log("=== Backfill Attempt Analytics Snapshots ===");
  console.log(`Config: batchSize=${batchSize}, force=${force}\n`);

  const filter = { status: { $in: ["SUBMITTED", "EVALUATED"] } };
  const totalFound = await TestAttempt.countDocuments(filter);
  console.log(`Found ${totalFound} completed/submitted attempts to inspect.\n`);

  const stats = {
    totalFound,
    updated: 0,
    skipped: 0,
    failed: 0,
    unverifiable: 0,
  };

  let skip = 0;
  while (skip < totalFound) {
    const attempts = await TestAttempt.find(filter)
      .sort({ _id: 1 })
      .skip(skip)
      .limit(batchSize)
      .lean();

    if (attempts.length === 0) break;

    // Filter attempts that need update
    const toProcess = [];
    for (const att of attempts) {
      if (!force && isValidSnapshot(att.analyticsSnapshot)) {
        stats.skipped++;
      } else {
        toProcess.push(att);
      }
    }

    if (toProcess.length > 0) {
      // 1. Batch fetch tests
      const testIds = Array.from(new Set(toProcess.map((a) => String(a.testId)).filter(Boolean)));
      const tests = await Test.find({ _id: { $in: testIds } })
        .populate("topicIds", "name")
        .populate("subjectIds", "name")
        .populate("subjectId", "name")
        .lean();
      const testMap = new Map(tests.map((t) => [String(t._id), t]));

      // 2. Batch fetch question difficulties
      const qIds = new Set();
      toProcess.forEach((a) => {
        (a.answers || []).forEach((ans) => {
          if (ans?.questionId) qIds.add(String(ans.questionId));
        });
      });
      const questions = await Question.find({ _id: { $in: Array.from(qIds) } })
        .select("_id difficulty")
        .lean();
      const qDiffMap = new Map(questions.map((q) => [String(q._id), q.difficulty]));

      // 3. Process each attempt
      for (const att of toProcess) {
        try {
          const test = testMap.get(String(att.testId));
          if (!test) {
            console.warn(`[UNVERIFIABLE] Attempt ${att._id} has missing testId ${att.testId}`);
            stats.unverifiable++;
            continue;
          }

          const snapshot = buildAttemptAnalyticsSnapshot({
            attempt: att,
            test,
            questionDifficultyMap: qDiffMap,
          });

          if (!isValidSnapshot(snapshot)) {
            console.warn(`[FAILED] Attempt ${att._id} generated invalid snapshot:`, snapshot);
            stats.failed++;
            continue;
          }

          await TestAttempt.updateOne(
            { _id: att._id },
            { $set: { analyticsSnapshot: snapshot } }
          );
          stats.updated++;
        } catch (err) {
          console.error(`[ERROR] Attempt ${att._id} error during snapshot generation:`, err);
          stats.failed++;
        }
      }
    }

    skip += attempts.length;
    process.stdout.write(`Processed ${Math.min(skip, totalFound)}/${totalFound} attempts...\r`);
  }

  const durationMs = Date.now() - startTime;
  console.log("\n\n========================================");
  console.log("BACKFILL SUMMARY REPORT");
  console.log("========================================");
  console.log(`Total Found:    ${stats.totalFound}`);
  console.log(`Updated:        ${stats.updated}`);
  console.log(`Skipped:        ${stats.skipped}`);
  console.log(`Unverifiable:   ${stats.unverifiable}`);
  console.log(`Failed:         ${stats.failed}`);
  console.log(`Duration:       ${(durationMs / 1000).toFixed(2)}s`);
  console.log("========================================\n");

  return stats;
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith("backfillAttemptSnapshots.js")) {
  const force = process.argv.includes("--force");
  const batchArg = process.argv.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchArg ? parseInt(batchArg.split("=")[1], 10) : 50;

  mongoose
    .connect(mongoUri)
    .then(async () => {
      await backfillAttemptSnapshots({ batchSize, force });
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
