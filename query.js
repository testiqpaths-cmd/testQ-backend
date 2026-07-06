import mongoose from "mongoose";
import TestAttempt from "./src/models/testAttempt.model.js";

async function run() {
  await mongoose.connect("mongodb://localhost:27017/testportal"); // Change if env differs
  const attempts = await TestAttempt.find({ status: { $in: ["SUBMITTED", "EVALUATED"] } })
    .populate("testId", "title type")
    .limit(2)
    .lean();
  console.log("Attempts:", JSON.stringify(attempts, null, 2));
  process.exit();
}

run();
