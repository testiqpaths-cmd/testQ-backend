import { register as registerService } from "./auth.service.js";
import { login as loginService } from "./auth.service.js";
import { accessCookieOptions, refreshCookieOptions } from "../../config/cookie.js";
import { verifyRefreshToken, generateAccessToken } from "../../modules/auth/utils/token.service.js";
import { createUser, findUserByEmail, findUserById } from "./repositories/auth.repository.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import * as authService from "./auth.service.js";
import { generateOtpService ,verifyOtpService } from "./auth.service.js";

/** Register */
export const registerController = async (req, res) => {
  try {
    // Make sure we extract only the fields we need
    const { firstName, lastName, email, password, phone, role, plan, organizationId } = req.body;

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
        success : true,
        message: "Registration successful . Please verify OTP.",
        user: { id: user._id, email: user.email, role: user.role },
      });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({ 
      success:false,
      message: err.message });
  }
};

// generateOtpController
export const generateOtpController = async (req, res, next) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Call service to generate OTP and send email
    const { email, otp, expiresIn } = await generateOtpService(userId);

    res.status(200).json({
      success: true,
      message: `OTP generated and sent to ${email}`,
      data: {
        email,
        otp,        // For testing purposes, remove in production
        expiresIn,  // Timestamp in ms
      },
    });
  } catch (err) {
    console.error("generateOtpController error:", err);
    next(err); // Will be handled by your error middleware
  }
};

//verifyotp
export const verifyOtpController = async (req, res, next) => {
  try {
    const { userId, otp } = req.body; // POST body must contain userId and otp

    const result = await verifyOtpService(userId, otp);

    if (result) {
      res.status(200).json({
        success: true,
        message: "OTP verified successfully",
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }
  } catch (err) {
    next(err);
  }
};

/** Login */
export const loginController = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Call login service
    const { user, accessToken, refreshToken } = await loginService({ email, password });

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
    const newAccessToken = generateAccessToken({ id: decoded.id, role: decoded.role });

    res.cookie("accessToken", newAccessToken, accessCookieOptions);
    res.json({ message: "Access token refreshed" });
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ message: "Refresh token expired" });
    return res.status(401).json({ message: err.message || "Invalid refresh token" });
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
