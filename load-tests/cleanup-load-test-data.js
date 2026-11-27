import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import env from "../src/config/env.js";
import User from "../src/modules/auth/models/User.model.js";
import Question from "../src/models/question.model.js";
import Test from "../src/models/test.model.js";
import TestAssignment from "../src/models/testAssignment.model.js";
import TestAttempt from "../src/modules/test-attempts/models/testAttempt.model.js";
import Notification from "../src/modules/notification/notification.model.js";
import StudentPerformanceSummary from "../src/models/studentPerformanceSummary.model.js";
import DailyStudentActivity from "../src/models/dailyStudentActivity.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_TITLE = "[LOADTEST] Full-Stack Assessment Benchmark";
const EMAIL_REGEX = /^loadtest\.student\.\d+@loadtest\.testq\.local$/;
const FIXTURES_PATH = path.join(__dirname, ".generated", "fixtures.json");

async function main() {
  if (!env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in environment");
  }

  await mongoose.connect(env.MONGO_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    const users = await User.find({ email: EMAIL_REGEX })
      .setOptions({ includeDeleted: true })
      .select("_id")
      .lean();
    const tests = await Test.find({ title: TEST_TITLE }).select("_id").lean();

    const userIds = users.map((u) => u._id);
    const testIds = tests.map((t) => t._id);

    const attemptFilter = {
      $or: [
        ...(userIds.length ? [{ studentId: { $in: userIds } }] : []),
        ...(testIds.length ? [{ testId: { $in: testIds } }] : []),
      ],
    };

    const [attemptsRes, assignRes, notifRes, perfRes, dailyRes, qRes, testRes, userRes] =
      await Promise.all([
        userIds.length || testIds.length
          ? TestAttempt.deleteMany(attemptFilter)
          : { deletedCount: 0 },
        userIds.length || testIds.length
          ? TestAssignment.deleteMany(attemptFilter)
          : { deletedCount: 0 },
        userIds.length
          ? Notification.deleteMany({ userId: { $in: userIds } })
          : { deletedCount: 0 },
        userIds.length
          ? StudentPerformanceSummary.deleteMany({ studentId: { $in: userIds } })
          : { deletedCount: 0 },
        userIds.length
          ? DailyStudentActivity.deleteMany({ studentId: { $in: userIds } })
          : { deletedCount: 0 },
        Question.deleteMany({ excelBatchId: "LOADTEST_BATCH_V1" }),
        Test.deleteMany({ title: TEST_TITLE }),
        User.deleteMany({ email: EMAIL_REGEX }),
      ]);

    if (fs.existsSync(FIXTURES_PATH)) {
      fs.unlinkSync(FIXTURES_PATH);
    }

    console.log("[loadtest:cleanup] Removed load-test artifacts:");
    console.log(`  Users: ${userRes.deletedCount}`);
    console.log(`  Tests: ${testRes.deletedCount}`);
    console.log(`  Questions: ${qRes.deletedCount}`);
    console.log(`  Assignments: ${assignRes.deletedCount}`);
    console.log(`  Attempts: ${attemptsRes.deletedCount}`);
    console.log(`  Notifications: ${notifRes.deletedCount}`);
    console.log(`  Performance Summaries: ${perfRes.deletedCount}`);
    console.log(`  Daily Activities: ${dailyRes.deletedCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("[loadtest:cleanup] Failed:", err);
  process.exit(1);
});
