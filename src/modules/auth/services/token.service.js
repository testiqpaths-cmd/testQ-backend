import jwt from "jsonwebtoken";
import env  from "../../../config/env.js"
export const generateAccessToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN } // from env.js
  );


export const generateRefreshToken = (user) =>
  jwt.sign(
    { id: user.id },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN } // from env.js
  );


export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET);


//verify email
export const generateVerifyToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
};
