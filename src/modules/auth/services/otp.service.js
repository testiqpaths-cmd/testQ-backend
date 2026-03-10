import User from "../../../models/user.model.js";
import { sendVerifyEmail } from "./email.service.js";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/token.service.js";
import redisClient from "../../../config/redis.js";
import logger from "../../../config/logger.js";

// ==============================
// Rate-limit OTP requests (max 3 per 10 min)
export const checkOtpRateLimit = async (userId) => {
  const key = `otp:rate:${userId}`;
  const attempts = await redisClient.incr(key);

  if (attempts === 1) {
    await redisClient.expire(key, 600); // 10 min
  }

  if (attempts > 3) {
    throw new Error("Too many OTP requests. Try again later.");
  }
};

// ==============================
// Save OTP in Redis
export const saveOtp = async (userId, otp) => {
  await redisClient.set(`otp:${userId}`, otp.toString(), { EX: 300 }); // 5 min expiry
};

// ==============================
// Verify OTP from Redis
export const verifyOtp = async (userId, otp) => {
  const savedOtp = await redisClient.get(`otp:${userId}`);
  logger.debug(`Saved OTP from Redis: ${savedOtp}`);
  if (!savedOtp) throw new Error("OTP expired or not found");
  if (savedOtp !== otp.toString()) throw new Error("Invalid OTP");

  // Delete OTP after verification
  await redisClient.del(`otp:${userId}`);
  return true;
};

// ==============================
// Generate OTP Service
export const generateOtpService = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  await checkOtpRateLimit(userId);

  // force remove old otp so you never reuse it
  await redisClient.del(`otp:${userId}`);

  const otp = Math.floor(100000 + Math.random() * 900000);
  logger.debug(`GENERATED OTP: ${otp}`);

  await saveOtp(userId, otp);

  // Email may fail, don't crash OTP generation
  try {
    await sendVerifyEmail(user, otp);
  } catch (e) {
    logger.error(`Email failed: ${e.message}`);
  }

  return {
    email: user.email,
    expiresIn: 300,
    otp: process.env.NODE_ENV !== "production" ? otp : undefined, // dev only
  };
};


// ==============================
// Verify OTP Service
export const verifyOtpService = async (userId, otp) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  // 1️⃣ Verify OTP from Redis
  await verifyOtp(userId, otp);

  // 2️⃣ Mark email as verified in DB
  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();

  // 3️⃣ Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // 4️⃣ Store refresh token in DB
  user.refreshToken = refreshToken;
  await user.save();
  const fresh = await User.findById(userId);
  logger.debug(`AFTER VERIFY DB: ${fresh.email}, isEmailVerified: ${fresh.isEmailVerified}`);

  return {
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
    },
    accessToken,
    refreshToken,
  };
};
