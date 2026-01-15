import mongoose from "mongoose";
import env  from "./env.js";

export const connectDB = async () => {
  try {
    console.log("Connecting to MongoDB:", env.MONGO_URI);
    await mongoose.connect(env.MONGO_URI);
    console.log("MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};
