import dotenv from "dotenv";

dotenv.config();

const env = {
  // App
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT) || 5000,

  // MongoDB
  MONGO_URI: process.env.MONGO_URI,
  MONGO_USERNAME: process.env.MONGO_USERNAME,
  MONGO_PASSWORD: process.env.MONGO_PASSWORD,

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,

  // JWT
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,

  // Mail
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,

  // Cookies
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE || "lax",
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || "localhost",

  // Redis
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: Number(process.env.REDIS_PORT),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN,

  // Razorpay
  RAZORPAY_KEY_ID: process.env.RAZORPAY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
};

export default env;
