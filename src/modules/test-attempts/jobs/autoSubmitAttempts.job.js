import cron from "node-cron";
import { autoSubmitExpiredAttempts } from "../services/autoSubmitExpiredAttempts.service.js";

let isRunning = false;

export const startAutoSubmitJob = () => {
  // Run every 5 minutes to reduce CPU load and prevent missed executions
  cron.schedule("*/5 * * * *", async () => {
    if (isRunning) return; // ✅ prevent overlap
    isRunning = true;

    try {
      await autoSubmitExpiredAttempts();
    } catch (err) {
      console.error("❌ Auto-submit job error:", err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log("✅ Auto-submit cron started");
};
