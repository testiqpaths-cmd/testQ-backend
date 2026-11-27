import mongoose from "mongoose";
import env from "./env.js";
import logger from "./logger.js";
import Subject from "../models/subject.model.js";
import Topic from "../models/topic.model.js";
import TestAttempt from "../models/testAttempt.model.js";
import TestAssignment from "../models/testAssignment.model.js";
import Test from "../models/test.model.js";
import User from "../modules/auth/models/User.model.js";
import Question from "../models/question.model.js";
import TestSeries from "../models/testSeries.model.js";
import TestSeriesAssignment from "../models/testSeriesAssignment.model.js";
import Organization from "../models/organization.model.js";
import StudentPerformanceSummary from "../models/studentPerformanceSummary.model.js";
import DailyStudentActivity from "../models/dailyStudentActivity.model.js";
import PlatformDailySummary from "../models/platformDailySummary.model.js";

const ensureCriticalIndexes = async () => {
  // Safe, non-destructive: creates missing schema indexes without dropping unmanaged database indexes.
  // Full index maintenance can be executed via `node scripts/ensureProductionIndexes.js`.
  if (process.env.AUTO_ENSURE_INDEXES === "false") {
    logger.info("Automatic startup index check disabled via AUTO_ENSURE_INDEXES=false");
    return;
  }
  try {
    await Promise.all([
      Subject.createIndexes(),
      Topic.createIndexes(),
      TestAttempt.createIndexes(),
      TestAssignment.createIndexes(),
      Test.createIndexes(),
      User.createIndexes(),
      Question.createIndexes(),
      TestSeries.createIndexes(),
      TestSeriesAssignment.createIndexes(),
      Organization.createIndexes(),
      StudentPerformanceSummary.createIndexes(),
      DailyStudentActivity.createIndexes(),
      PlatformDailySummary.createIndexes(),
    ]);

    // Cleanup legacy stale index from older schema version on userfeatureusages
    try {
      const userFeatureUsages = mongoose.connection.collection("userfeatureusages");
      const indexes = await userFeatureUsages.indexes();
      const hasStaleIndex = indexes.some((i) => i.name === "userId_1_featureKey_1");
      if (hasStaleIndex) {
        await userFeatureUsages.dropIndex("userId_1_featureKey_1");
        logger.info("Dropped legacy stale index userId_1_featureKey_1 on userfeatureusages");
      }
    } catch (e) {
      // Ignore if index doesn't exist
    }

    logger.info("Critical indexes ensured successfully (non-destructive)");
  } catch (error) {
    logger.warn(`Index verification skipped: ${error.message}`);
  }
};

export const connectDB = async () => {
  try {
    logger.info(`Connecting to MongoDB: ${env.MONGO_URI}`);
    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 100,
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 20,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    await ensureCriticalIndexes();
    logger.info("MongoDB connected successfully");
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
};
