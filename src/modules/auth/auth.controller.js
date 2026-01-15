import { login, register } from "./auth.service.js";
import { accessCookieOptions, refreshCookieOptions } from "../../config/cookie.js";
import { verifyRefreshToken, generateAccessToken } from "./services/token.service.js";
import { authRepository } from "./repositories/auth.repository.js";
import { AuthError } from "../../common/exceptions/AuthError.js";

/** Register */
export const registerController = async (req, res) => {
  try {
    const { user, accessToken, refreshToken } = await register(req.body);
    res
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .status(201)
      .json({ message: "Registration successful", user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/** Login */
export const loginController = async (req, res) => {
  try {
    const { user, accessToken, refreshToken } = await login(req.body);
    res
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .json({ message: "Login successful", user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
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
