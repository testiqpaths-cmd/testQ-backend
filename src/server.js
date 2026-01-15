import app from "./app.js";
import env  from "./config/env.js";
import { connectDB } from "./config/db.js";

const PORT = env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log("MongoDB connected successfully");

    // Start Express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1); // Stop server if DB connection fails
  }
};

// Start everything
startServer();
