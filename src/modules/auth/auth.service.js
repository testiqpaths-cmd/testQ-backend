import bcrypt from "bcryptjs";
import User from "../../models/user.model.js"; // import your User model
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByFirebaseUid,
} from "./repositories/auth.repository.js";
import {generateAccessToken,generateRefreshToken,} from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
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
    isEmailVerified: true,
  });

  return user;
};



//login
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

export const firebaseAuth = async ({
  firebaseUid,
  email,
  firstName,
  lastName,
  displayName,
  photoURL,
}) => {
  if (!firebaseUid || !email) {
    throw new AuthError("firebaseUid and email are required");
  }

  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByEmail(email);
  }

  if (!user) {
    const [derivedFirstName = "Student", ...rest] = (displayName || "").trim().split(" ");
    const derivedLastName = rest.join(" ");
    const randomPassword = `${firebaseUid}:${Date.now()}`;
    const hashedPassword = await passwordService.hash(randomPassword);

    user = await createUser({
      firstName: firstName || derivedFirstName || "Student",
      lastName: lastName || derivedLastName || "",
      email,
      password: hashedPassword,
      role: "STUDENT",
      firebaseUid,
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
    });
  } else {
    const updates = {
      role: "STUDENT",
      isEmailVerified: true,
      emailVerifiedAt: user.emailVerifiedAt || new Date(),
      lastLogin: new Date(),
    };

    if (!user.firebaseUid) {
      updates.firebaseUid = firebaseUid;
    }

    if (!user.firstName && (firstName || displayName)) {
      updates.firstName = firstName || displayName;
    }

    if (!user.lastName && lastName) {
      updates.lastName = lastName;
    }

    user = await User.findByIdAndUpdate(user._id, updates, { new: true });
  }

  const accessToken = generateAccessToken({ id: user._id, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role });

  return { user, accessToken, refreshToken, photoURL };
};
