// src/common/utils/jwt.js
import jwt from "jsonwebtoken";
import env from "../../config/env.js";

export const signToken = (payload, secret, expiresIn) => {
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyToken = (token, secret) => {
  return jwt.verify(token, secret);
};
