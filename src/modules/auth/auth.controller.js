import User from "../../models/user.model.js";
import { register as registerService } from "./auth.service.js";
import { login as loginService } from "./auth.service.js";
import {
  accessCookieOptions,
  refreshCookieOptions,
} from "../../config/cookie.js";
import {
  verifyRefreshToken,
  generateAccessToken,
} from "../../modules/auth/utils/token.service.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
} from "./repositories/auth.repository.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import * as authService from "./auth.service.js";
import {
  generateOtpService,
  verifyOtpService,
} from "./services/otp.service.js";
import {
  saveOtp,
  verifyOtp,
  checkOtpRateLimit,
} from "./services/otp.service.js";
import { sendVerifyEmail } from "./services/email.service.js";


/** Register */
export const registerController = async (req, res) => {
  try {
    console.log("REGISTER BODY 👉", req.body);
    // Make sure we extract only the fields we need
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      role,
      plan,
      organizationId,
    } = req.body;

    // Call service with clean data
    const user = await registerService({
      firstName,
      lastName,
      email,
      password,
      phone,
      role,
      plan,
      organizationId,
    });

    // Set cookies and respond
    res.status(201).json({
      success: true,
      message: "Registration successful . Please verify OTP.",
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};



  export const generateOtpController = async (req, res, next) => {
    try {
      const { id: userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      await checkOtpRateLimit(userId);

      const otp = Math.floor(100000 + Math.random() * 900000);
      console.log("🔥 GENERATED OTP:", otp, "for user:", userId);
      await saveOtp(userId, otp);

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Try sending email (don’t break flow)
      try {
        await sendVerifyEmail(user, otp);
      } catch (e) {
        console.error("Email failed:", e.message);
      }

      return res.status(200).json({
        success: true,
        message: "OTP generated",
        data: {
          email: user.email,
          otp: process.env.NODE_ENV !== "production" ? otp : undefined, // 👈 key line
          expiresIn: 5 * 60, // seconds
        },
      });

    } catch (err) {
      next(err);
    }
  };



// ==============================
// Verify OTP Controller
// ==============================
export const verifyOtpController = async (req, res, next) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required",
      });
    }

    // ✅ call the service that updates DB + tokens
    const result = await verifyOtpService(userId, otp);

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      data: result, // includes user + accessToken + refreshToken
    });
  } catch (err) {
    console.error("OTP verification error:", err);

    return res.status(400).json({
      success: false,
      message: err?.message || "Server error",
      errors: null,
    });
  }
};



/** Login */
export const loginController = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Call login service
    const { user, accessToken, refreshToken } = await loginService({
      email,
      password,
    });

    // Set cookies
    res
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .status(200)
      .json({
        success: true,
        message: "Login successful",
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified, // ✅ include verification status
        },
      });
  } catch (err) {
    console.error("Login error:", err);
    res.status(401).json({ success: false, message: err.message });
  }
};

/** Refresh token */
export const refreshTokenController = (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) throw new AuthError("Refresh token missing");

    const decoded = verifyRefreshToken(refreshToken);
    const newAccessToken = generateAccessToken({
      id: decoded.id,
      role: decoded.role,
    });

    res.cookie("accessToken", newAccessToken, accessCookieOptions);
    res.json({ message: "Access token refreshed" });
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Refresh token expired" });
    return res
      .status(401)
      .json({ message: err.message || "Invalid refresh token" });
  }
};

/** Logout */
export const logoutController = (req, res) => {
  res
    .clearCookie("accessToken", accessCookieOptions)
    .clearCookie("refreshToken", refreshCookieOptions)
    .json({ message: "Logged out successfully" });
};

/** /me - get current user */
export const meController = async (req, res) => {
  try {
    const user = await authRepository.findById(req.user.id);
    if (!user) throw new AuthError("User not found");
    res.json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

// email
export const registerverify = async (req, res) => {
  await authService.registerUser(req.body);

  res.status(201).json({
    success: true,
    message: "Verification email sent",
  });
};
