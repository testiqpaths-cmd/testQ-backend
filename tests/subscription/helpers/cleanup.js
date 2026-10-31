import mongoose from "mongoose";

export const clearTestDB = async () => {
  if (mongoose.connection.readyState !== 1) return;

  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    try {
      await collections[key].deleteMany({});
    } catch (err) {
      // Ignore if collection not found
    }
  }
};

