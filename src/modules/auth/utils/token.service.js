import jwt from "jsonwebtoken";
import env from "../../../config/env.js";

export const generateAccessToken = (user) =>
  jwt.sign(
    {
      id: user._id?.toString() || user.id,     // ✅ always set id properly
      role: user.role,
      
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  );

export const generateRefreshToken = (user) =>
  jwt.sign(
    {
      id: user._id?.toString() || user.id,
      role: user.role,
    },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET);

// verify email
export const generateVerifyToken = (userId) => {
  return jwt.sign(
    { userId },
    env.JWT_ACCESS_SECRET, // ✅ use env, not process.env
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
};
