import crypto from "crypto";

export const randomPassword = (length = 10) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()";

  let password = "";

  while (password.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < chars.length * Math.floor(256 / chars.length)) {
      password += chars[byte % chars.length];
    }
  }

  return password;
};