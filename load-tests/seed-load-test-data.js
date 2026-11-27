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
import { passwordService } from "../src/modules/auth/services/password.service.js";
import { generateAccessToken } from "../src/modules/auth/utils/token.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_COUNT = Math.max(1, Number(process.env.LOADTEST_USER_COUNT || 1000));
const PASSWORD = process.env.LOADTEST_PASSWORD || "LoadTest@12345";
const TEST_TITLE = "[LOADTEST] Full-Stack Assessment Benchmark";
const EMAIL_REGEX = /^loadtest\.student\.\d+@loadtest\.testq\.local$/;
const OUTPUT_DIR = path.join(__dirname, ".generated");
const FIXTURES_PATH = path.join(OUTPUT_DIR, "fixtures.json");

const sanitizeMongoUri = (uri = "") =>
  uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");

const isLocalMongo = (uri = "") =>
  /\/\/(?:[^@]+@)?(?:localhost|127\.0\.0\.1)(?::\d+)?\b/i.test(uri);

async function main() {
  if (!env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in environment");
  }

  const allowRemote =
    process.argv.includes("--confirm-remote") || process.env.ALLOW_REMOTE_SEED === "true";

  if (!isLocalMongo(env.MONGO_URI) && !allowRemote) {
    console.error(
      `[loadtest:seed] Refusing to seed 1000 users into non-local MongoDB (${sanitizeMongoUri(env.MONGO_URI)}) without explicit confirmation.`
    );
    console.error(
      "[loadtest:seed] If this is your Staging/Test cluster (NOT Production), run:\n" +
        "  npm run loadtest:seed -- --confirm-remote"
    );
    process.exit(1);
  }

  console.log(`[loadtest:seed] Connecting to MongoDB: ${sanitizeMongoUri(env.MONGO_URI)}`);
  await mongoose.connect(env.MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    // 1. Clean any prior load-test entities so re-seeding is deterministic & idempotent
    const existingUsers = await User.find({ email: EMAIL_REGEX })
      .setOptions({ includeDeleted: true })
      .select("_id")
      .lean();
    const existingTests = await Test.find({ title: TEST_TITLE }).select("_id").lean();

    const oldUserIds = existingUsers.map((u) => u._id);
    const oldTestIds = existingTests.map((t) => t._id);

    if (oldUserIds.length || oldTestIds.length) {
      console.log(
        `[loadtest:seed] Cleaning previous fixtures (${oldUserIds.length} users, ${oldTestIds.length} tests)...`
      );
      await Promise.all([
        TestAttempt.deleteMany({
          $or: [
            ...(oldUserIds.length ? [{ studentId: { $in: oldUserIds } }] : []),
            ...(oldTestIds.length ? [{ testId: { $in: oldTestIds } }] : []),
          ],
        }),
        TestAssignment.deleteMany({
          $or: [
            ...(oldUserIds.length ? [{ studentId: { $in: oldUserIds } }] : []),
            ...(oldTestIds.length ? [{ testId: { $in: oldTestIds } }] : []),
          ],
        }),
        Notification.deleteMany(
          oldUserIds.length ? { userId: { $in: oldUserIds } } : { _id: null }
        ),
        Question.deleteMany({ excelBatchId: "LOADTEST_BATCH_V1" }),
        Test.deleteMany({ title: TEST_TITLE }),
        User.deleteMany({ email: EMAIL_REGEX }),
      ]);
    }

    // 2. Bulk-create synthetic student accounts with a shared bcrypt hash for speed
    console.log(`[loadtest:seed] Creating ${USER_COUNT} synthetic student accounts...`);
    const passwordHash = await passwordService.hash(PASSWORD);
    const userDocs = Array.from({ length: USER_COUNT }, (_, idx) => {
      const n = idx + 1;
      return {
        firstName: "LoadTest",
        lastName: `Student${n}`,
        email: `loadtest.student.${n}@loadtest.testq.local`,
        password: passwordHash,
        hasSetPassword: true,
        role: "STUDENT",
        status: "ACTIVE",
        plan: "FREE",
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        isDeleted: false,
      };
    });

    const createdUsers = await User.insertMany(userDocs, { ordered: false });

    // 3. Create a creator admin/user anchor & 10 MCQ questions
    const creatorId = createdUsers[0]._id;
    const questionDocs = Array.from({ length: 10 }, (_, idx) => {
      const qNum = idx + 1;
      return {
        questionText: `[LOADTEST Q${qNum}] What is ${qNum} + ${qNum}?`,
        type: "MCQ",
        options: [`${qNum}`, `${qNum * 2}`, `${qNum * 3}`, `${qNum + 1}`],
        correctAnswer: `${qNum * 2}`,
        difficulty: idx % 3 === 0 ? "EASY" : idx % 3 === 1 ? "MEDIUM" : "HARD",
        createdBy: creatorId,
        excelBatchId: "LOADTEST_BATCH_V1",
        excelBatchName: "LoadTest Benchmark",
      };
    });

    const createdQuestions = await Question.insertMany(questionDocs);
    const questionIds = createdQuestions.map((q) => q._id);
    const questionSnapshot = createdQuestions.map((q, idx) => ({
      _id: q._id,
      questionId: q._id,
      questionText: q.questionText,
      type: q.type,
      options: q.options,
      correctAnswer: q.correctAnswer,
      imageUrl: null,
      difficulty: q.difficulty,
      marks: 1,
      order: idx + 1,
    }));

    // 4. Create 1 PUBLIC published objective test allowing repeated runs per student
    const testDoc = await Test.create({
      title: TEST_TITLE,
      description: "Synthetic objective test used for load testing up to 1000 VUs.",
      questions: questionIds,
      questionSnapshot,
      createdBy: {
        userId: creatorId,
        role: "IQPATH_ADMIN",
      },
      visibility: "PUBLIC",
      totalQuestions: createdQuestions.length,
      questionSource: "EXCEL",
      excelBatchId: "LOADTEST_BATCH_V1",
      difficulty: ["EASY", "MEDIUM", "HARD"],
      type: ["MCQ"],
      duration: 60,
      maxAttempts: 100000,
      totalMarks: createdQuestions.length,
      marksPerQuestion: 1,
      negativeMarkingPercentage: 0,
      scheduleType: "IMMEDIATE",
      isPublished: true,
      publishedAt: new Date(),
      status: "PUBLISHED",
      secureBrowserRequired: false,
      isIQRoomTest: false,
      isDeleted: 0,
    });

    // 5. Pre-accept TestAssignment for all seeded students so starttest gate passes cleanly
    const now = new Date();
    const assignmentDocs = createdUsers.map((u) => ({
      testId: testDoc._id,
      studentId: u._id,
      status: "ACCEPTED",
      acceptedAt: now,
    }));
    await TestAssignment.insertMany(assignmentDocs, { ordered: false });

    // 6. Write fixtures.json with pre-minted JWTs (for exam/dashboard load) + credentials (for login burst)
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const fixtures = {
      generatedAt: new Date().toISOString(),
      userCount: createdUsers.length,
      password: PASSWORD,
      testId: testDoc._id.toString(),
      questions: createdQuestions.map((q) => ({
        id: q._id.toString(),
        correctAnswer: q.correctAnswer,
      })),
      users: createdUsers.map((u) => ({
        id: u._id.toString(),
        email: u.email,
        accessToken: generateAccessToken(u),
      })),
    };

    fs.writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2), "utf8");
    console.log(`[loadtest:seed] Seeded ${createdUsers.length} users + test ${testDoc._id}`);
    console.log(`[loadtest:seed] Fixtures written to: ${FIXTURES_PATH}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("[loadtest:seed] Failed:", err);
  process.exit(1);
});
