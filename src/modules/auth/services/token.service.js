import jwt from "jsonwebtoken";
import { env } from "../../../config/env.js";

export const generateAccessToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );

export const generateRefreshToken = (user) =>
  jwt.sign(
    { id: user.id },
    env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET);