import bcrypt from "bcryptjs";
import User from "../../models/user.model.js"; // import your User model
import {createUser,findUserByEmail,findUserById,} from "./repositories/auth.repository.js";
import {generateAccessToken,generateRefreshToken,generateVerifyToken,} from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import { sendVerifyEmail } from "./services/email.service.js";
import { passwordService } from "./services/password.service.js";



/** Register user */
export const register = async (userData) => {
  const { firstName, lastName, email, password } = userData;

  if (!firstName || !lastName || !email || !password) {
    throw new AuthError(
      "firstName, lastName, email, and password are required",
    );
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new AuthError("User already exists");
  }

  const hashedPassword = await passwordService.hash(password);

  const user = await createUser({
    ...userData,
    password: hashedPassword,
    isEmailVerified: false,
  });

  return user;
};



//login
export const login = async ({ email, password }) => {
  const user = await findUserByEmail(email);
  if (!user) throw new AuthError("Invalid credentials");

  // ✅ Check if email is verified
  if (!user.isEmailVerified) {
    throw new AuthError("Email not verified. Please verify your email before logging in.");
  }

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
  const user = await createUser(data);

  const token = generateVerifyToken(user._id);

  await sendVerifyEmail(user, token);

  return user;
};
