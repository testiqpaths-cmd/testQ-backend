import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import User from "../../models/user.model.js"; // import your User model
import {createUser,findUserByEmail,findUserById,} from "./repositories/auth.repository.js";
import {generateAccessToken,generateRefreshToken,generateVerifyToken,} from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import { sendVerifyEmail } from "./services/email.service.js";
import { passwordService } from "./services/password.service.js";

// Required for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Register user */
export const register = async (userData) => {
  const { firstName, lastName, email, password } = userData;

  if (!firstName || !lastName || !email || !password) {
    throw new AuthError(
      "firstName, lastName, email, and password are required",
    );
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new AuthError("User already exists");
  }

  const hashedPassword = await passwordService.hash(password);

  const user = await createUser({
    ...userData,
    password: hashedPassword,
    isVerified: false,
  });

  return user;
};

//generateotp
export const generateOtpService = async (userId) => {
  // 1️⃣ Find user
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const email = user.email;

  // 2️⃣ Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000);

  // 3️⃣ Expiry: 5 minutes from now
  const expiresIn = Date.now() + 5 * 60 * 1000;

  // 4️⃣ Update user with OTP
  user.emailOtp = {
    code: otp,
    expiresIn,
    createdAt: new Date(),
  };

  await user.save();

  // 5️⃣ Load email template
  const templatePath = path.join(__dirname, "templates", "verify-email.html");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found at ${templatePath}`);
  }

  let html = fs.readFileSync(templatePath, "utf-8");

  // 6️⃣ Replace placeholders
  html = html
    .replace("{{name}}", user.firstName)
    .replace("{{verifyLink}}", `Your OTP: ${otp}`)
    .replace("{{expiry}}", "5");

  // 7️⃣ Send email
  await sendVerifyEmail(user, otp);

  // 8️⃣ Return info (for testing)
  return { email, otp, expiresIn };
};

//verifyotp 
export const verifyOtpService = async (userId, otp) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  // Make sure OTP exists
  if (!user.emailOtp || !user.emailOtp.code) {
    throw new Error("OTP not generated for this user");
  }

  const currentTime = Date.now();

  // Check OTP match and expiry
  if (user.emailOtp.code !== Number(otp)) return false;         // OTP mismatch
  if (user.emailOtp.expiresIn < currentTime) return false;     // OTP expired

  // OTP verified → update user
  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();

  // Clear OTP fields
  user.emailOtp = undefined;

  await user.save();

  return true;
};

//login
export const login = async ({ email, password }) => {
  const user = await findUserByEmail(email);
  if (!user) throw new AuthError("Invalid credentials");

  // ✅ Check if email is verified
  if (!user.isEmailVerified) {
    throw new AuthError("Email not verified. Please verify your email before logging in.");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new AuthError("Invalid credentials");

  return {
    user,
    accessToken: generateAccessToken({ id: user._id, role: user.role }),
    refreshToken: generateRefreshToken({ id: user._id, role: user.role }),
  };
};

//email

export const registerUser = async (data) => {
  const user = await createUser(data);

  const token = generateVerifyToken(user._id);

  await sendVerifyEmail(user, token);

  return user;
};
