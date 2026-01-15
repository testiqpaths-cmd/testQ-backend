import bcrypt from "bcryptjs";
import { authRepository } from "./repositories/auth.repository.js";
import { generateAccessToken, generateRefreshToken } from "./services/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";

export const register = async ({ email, password, role = "user" }) => {
  const existingUser = await authRepository.findByEmail(email);
  if (existingUser) throw new AuthError("User already exists");

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await authRepository.create({ email, password: hashedPassword, role });

  return {
    user,
    accessToken: generateAccessToken({ id: user.id, role: user.role }),
    refreshToken: generateRefreshToken({ id: user.id }),
  };
};

export const login = async ({ email, password }) => {
  const user = await authRepository.findByEmail(email);
  if (!user) throw new AuthError("Invalid credentials");

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new AuthError("Invalid credentials");

  return {
    user,
    accessToken: generateAccessToken({ id: user.id, role: user.role }),
    refreshToken: generateRefreshToken({ id: user.id }),
  };
};
