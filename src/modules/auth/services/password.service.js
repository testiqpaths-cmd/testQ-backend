// src/modules/auth/services/password.service.js
import bcrypt from "bcryptjs";

export const passwordService = {
  hash: async (password) => {
    return await bcrypt.hash(password, 10);
  },
  compare: async (password, hash) => {
    return await bcrypt.compare(password, hash);
  },
};
