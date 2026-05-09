import mongoose from "mongoose";
import env from "./env.js";
import logger from "./logger.js";
import Subject from "../models/subject.model.js";
import Topic from "../models/topic.model.js";
import TestAttempt from "../models/testAttempt.model.js";

const syncCriticalIndexes = async () => {
  try {
    // Ensure current schema indexes are active and stale ones are removed.
    await Subject.syncIndexes();
    await Topic.syncIndexes();
    await TestAttempt.syncIndexes();
    logger.info("Subject/Topic/TestAttempt indexes synchronized successfully");
  } catch (error) {
    logger.warn(`Index synchronization skipped: ${error.message}`);
  }
};

export const connectDB = async () => {
  try {
    logger.info(`Connecting to MongoDB: ${env.MONGO_URI}`);
    await mongoose.connect(env.MONGO_URI);
    await syncCriticalIndexes();
    logger.info("MongoDB connected successfully");
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};
