import cron from "node-cron";
import { autoSubmitExpiredAttempts } from "../services/autoSubmitExpiredAttempts.service.js";

export const startAutoSubmitJob = () => {
  cron.schedule("*/30 * * * * *", async () => {
    try {
      const { modified } = await autoSubmitExpiredAttempts();

      if (modified > 0) {
        console.log(`✅ Auto-submitted ${modified} expired attempts`);
      }
    } catch (err) {
      console.error("❌ Auto-submit job error:", err.message);
    }
  });

  console.log("✅ Auto-submit cron started");
};
