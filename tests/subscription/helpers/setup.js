import crypto from "crypto";
import mongoose from "mongoose";
import env from "../../../src/config/env.js";

if (!globalThis.crypto) {
  globalThis.crypto = crypto;
}

export const connectTestDB = async (retries = 3) => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const u = new URL(env.MONGO_URI);
  u.pathname = "/test_sub_acceptance";

  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(u.toString(), {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
      });
      return mongoose.connection;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
};

export const disconnectTestDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};
