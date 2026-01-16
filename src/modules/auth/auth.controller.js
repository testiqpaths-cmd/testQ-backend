import { register as registerService } from "./auth.service.js";
import { login as loginService } from "./auth.service.js";
import { accessCookieOptions, refreshCookieOptions } from "../../config/cookie.js";
import { verifyRefreshToken, generateAccessToken } from "./services/token.service.js";
import { createUser, findUserByEmail, findUserById } from "./repositories/auth.repository.js";
import { AuthError } from "../../common/exceptions/AuthError.js";

/** Register */
export const registerController = async (req, res) => {
  try {
    // Make sure we extract only the fields we need
    const { firstName, lastName, email, password, phone, role, plan, organizationId } = req.body;

    // Call service with clean data
    const { user, accessToken, refreshToken } = await registerService({
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
    res
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .status(201)
      .json({
        message: "Registration successful",
        user: { id: user._id, email: user.email, role: user.role },
      });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({ message: err.message });
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
      .json({
        message: "Login successful",
        user: {
          id: user._id,       // _id instead of id for Mongoose
          email: user.email,
          role: user.role,
        },
      });
  } catch (err) {
    console.error("Login error:", err);
    res.status(401).json({ message: err.message });
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
