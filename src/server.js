import app from "./app.js";
import env  from "./config/env.js";
import { connectDB } from "./config/db.js";
import logger from "./config/logger.js";
import { startAutoSubmitJob } from "./modules/test-attempts/jobs/autoSubmitAttempts.job.js";
import { setupSockets } from "./sockets/index.js";
import http from "http";

const PORT = env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    logger.info("MongoDB connected successfully");
    console.log("MongoDB connected successfully");

    // ✅ Start cron/background job AFTER DB is ready
    startAutoSubmitJob();

    // Start Express server wrapped in HTTP server
    const server = http.createServer(app);
    setupSockets(server);

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1); // Stop server if DB connection fails
  }
};

// Start everything
startServer();
