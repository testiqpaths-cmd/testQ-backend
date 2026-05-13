import bcrypt from "bcryptjs";
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByFirebaseUid,
} from "./repositories/auth.repository.js";
import { User } from "./index.js";
import {generateAccessToken,generateRefreshToken,} from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import { passwordService } from "./services/password.service.js";

const normalizeRequiredString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const normalizeOptionalString = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
};

const normalizeEmail = (value) => normalizeRequiredString(value).toLowerCase();

const sanitizeUserCreatePayload = (payload) => {
  const sanitized = {
    ...payload,
    firstName: normalizeRequiredString(payload.firstName),
    lastName: normalizeOptionalString(payload.lastName),
    email: normalizeEmail(payload.email),
    phone: normalizeOptionalString(payload.phone),
    firebaseUid: normalizeOptionalString(payload.firebaseUid),
  };

  if (!sanitized.lastName) delete sanitized.lastName;
  if (!sanitized.phone) delete sanitized.phone;
  if (!sanitized.firebaseUid) delete sanitized.firebaseUid;

  return sanitized;
};



/** Register user */
export const register = async (userData) => {
  const firstName = normalizeRequiredString(userData?.firstName);
  const lastName = normalizeOptionalString(userData?.lastName);
  const email = normalizeEmail(userData?.email);
  const password = normalizeRequiredString(userData?.password);

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

  const user = await createUser(sanitizeUserCreatePayload({
    ...userData,
    firstName,
    lastName,
    email,
    password: hashedPassword,
    isEmailVerified: true,
  }));

  return {
    user,
    accessToken: generateAccessToken({ id: user._id, role: user.role }),
    refreshToken: generateRefreshToken({ id: user._id, role: user.role }),
  };
};



//login
export const login = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizeRequiredString(password);

  if (!normalizedEmail || !normalizedPassword) {
    throw new AuthError("Invalid credentials");
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) throw new AuthError("Invalid credentials");

  const isMatch = await bcrypt.compare(normalizedPassword, user.password);
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
  const normalizedFirebaseUid = normalizeRequiredString(firebaseUid);
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedFirebaseUid || !normalizedEmail) {
    throw new AuthError("firebaseUid and email are required");
  }

  let user = await findUserByFirebaseUid(normalizedFirebaseUid);
  if (!user) {
    user = await findUserByEmail(normalizedEmail);
  }

  if (!user) {
    const [derivedFirstName = "Student", ...rest] = (displayName || "").trim().split(" ");
    const derivedLastName = rest.join(" ");
    const randomPassword = `${normalizedFirebaseUid}:${Date.now()}`;
    const hashedPassword = await passwordService.hash(randomPassword);

    user = await createUser({
      ...sanitizeUserCreatePayload({
      firstName: firstName || derivedFirstName || "Student",
      lastName: lastName || derivedLastName || "",
      email: normalizedEmail,
      password: hashedPassword,
      role: "STUDENT",
      firebaseUid: normalizedFirebaseUid,
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      lastLogin: new Date(),
      status: "ACTIVE",
      }),
    });
  } else {
    if (
      user.firebaseUid &&
      String(user.firebaseUid).trim() !== normalizedFirebaseUid
    ) {
      throw new AuthError(
        "This email is already linked to another Firebase account",
      );
    }

    const updates = {
      role: "STUDENT",
      isEmailVerified: true,
      emailVerifiedAt: user.emailVerifiedAt || new Date(),
      lastLogin: new Date(),
    };

    if (!user.firebaseUid) {
      updates.firebaseUid = normalizedFirebaseUid;
    }

    if (!user.firstName && (firstName || displayName)) {
      updates.firstName = firstName || displayName;
    }

    if (!user.lastName && lastName) {
      updates.lastName = lastName;
    }

    updates.firebaseUid = normalizeOptionalString(updates.firebaseUid);
    updates.firstName = normalizeOptionalString(updates.firstName) || user.firstName;
    updates.lastName = normalizeOptionalString(updates.lastName) || user.lastName;

    if (!updates.firebaseUid) {
      delete updates.firebaseUid;
    }

    user = await User.findByIdAndUpdate(user._id, updates, { new: true });
  }

  // eslint-disable-next-line no-console
  console.info("Firebase auth persisted to backend", {
    userId: user?._id,
    email: user?.email,
    firebaseUid: user?.firebaseUid,
    role: user?.role,
    status: user?.status,
    lastLogin: user?.lastLogin,
  });

  const accessToken = generateAccessToken({ id: user._id, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role });

  return { user, accessToken, refreshToken, photoURL };
};
