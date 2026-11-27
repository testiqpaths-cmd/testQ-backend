import crypto from "node:crypto";
if (!global.crypto) global.crypto = crypto;
if (!globalThis.crypto) globalThis.crypto = crypto;

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
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    setupSockets(server);

    const backlog = Number(process.env.HTTP_LISTEN_BACKLOG) || 2048;
    server.listen({ port: PORT, backlog }, () => {
      logger.info(`Server running on port ${PORT} (backlog=${backlog})`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1); // Stop server if DB connection fails
  }
};

// Start everything
startServer();
