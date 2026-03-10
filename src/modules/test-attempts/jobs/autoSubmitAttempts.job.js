import cron from "node-cron";
import { autoSubmitExpiredAttempts } from "../services/autoSubmitExpiredAttempts.service.js";

let isRunning = false;

export const startAutoSubmitJob = () => {
  cron.schedule("*/30 * * * * *", async () => {
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
