import mongoose from "mongoose";
import env from "./env.js";
import logger from "./logger.js";
import Subject from "../models/subject.model.js";
import Topic from "../models/topic.model.js";
import TestAttempt from "../models/testAttempt.model.js";
import TestAssignment from "../models/testAssignment.model.js";

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
    ]);
    logger.info("Subject/Topic/TestAttempt/TestAssignment indexes ensured successfully (non-destructive)");
  } catch (error) {
    logger.warn(`Index verification skipped: ${error.message}`);
  }
};

export const connectDB = async () => {
  try {
    logger.info(`Connecting to MongoDB: ${env.MONGO_URI}`);
    await mongoose.connect(env.MONGO_URI);
    await ensureCriticalIndexes();
    logger.info("MongoDB connected successfully");
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
};
