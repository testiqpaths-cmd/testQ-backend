import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { getStudentDashboardData } from "../../src/modules/analytics/dashboard/dashboard.service.js";

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const data = await getStudentDashboardData("6a58fcec24446ef390bf4cf5");
    console.log("totalTestsAttempted:", data.totalTestsAttempted);
    console.log("percentageAchieved:", data.percentageAchieved);
    console.log("accuracy:", data.accuracy);
    console.log("activeAssignedTestsCount:", data.activeAssignedTestsCount);
    console.log("tests count:", data.tests.length);
    console.log("allTests count:", data.allTests.length);
    console.log("subjectWiseTests sample:", data.subjectWiseTests.slice(0, 3));
    console.log("performanceOverTime weekly sample:", data.performanceOverTime.weekly.slice(0, 3));
    console.log("tests[0]:", {
      name: data.tests[0]?.name,
      category: data.tests[0]?.category,
      difficulty: data.tests[0]?.difficulty,
      timeTaken: data.tests[0]?.timeTaken,
      status: data.tests[0]?.status,
    });
    console.log("allTests[0]:", {
      name: data.allTests[0]?.name,
      subject: data.allTests[0]?.subject,
      topic: data.allTests[0]?.topic,
      difficultyBreakdown: data.allTests[0]?.difficultyBreakdown,
      timeTaken: data.allTests[0]?.timeTaken,
      percentage: data.allTests[0]?.percentage,
      accuracy: data.allTests[0]?.accuracy,
      score: data.allTests[0]?.score,
      maxScore: data.allTests[0]?.maxScore
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
