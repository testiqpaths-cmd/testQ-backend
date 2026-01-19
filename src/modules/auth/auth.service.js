import bcrypt from "bcryptjs";
import User from "../../models/user.model.js"; // import your User model
import { createUser, findUserByEmail, findUserById } from "./repositories/auth.repository.js";
import { generateAccessToken, generateRefreshToken } from "./services/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import { sendVerifyEmail } from "./services/email.service.js";
import { generateVerifyToken } from "./services/token.service.js";

/** Register user */
export const register = async (userData) => {
  if (!userData.firstName || !userData.lastName || !userData.email || !userData.password) {
    throw new AuthError("firstName, lastName, email, and password are required");
  }

  const hashedPassword = await bcrypt.hash(userData.password, 10);
  const user = await createUser({ ...userData, password: hashedPassword });

  const accessToken = generateAccessToken({ id: user._id, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role });

  return { user, accessToken, refreshToken };
};

/** Login user */
export const login = async ({ email, password }) => {
  const user = await findUserByEmail(email);
  if (!user) throw new AuthError("Invalid credentials");

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
  const user = await authRepository.create(data);

  const token = generateVerifyToken(user._id);

  await sendVerifyEmail(user, token); // ✅ dynamic user

  return user;
};






