import mongoose from "mongoose";
import env from "./env.js";
import logger from "./logger.js";
export const connectDB = async () => {
  try {
    logger.info(`Connecting to MongoDB: ${env.MONGO_URI}`);
    await mongoose.connect(env.MONGO_URI);
    logger.info("MongoDB connected successfully");
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};
