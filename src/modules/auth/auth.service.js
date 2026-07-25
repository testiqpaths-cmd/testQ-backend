import bcrypt from "bcryptjs";
import {
  createUser,
  findUserByEmail,
  findUserByPhone,
  findUserById,
  findUserByFirebaseUid,
} from "./repositories/auth.repository.js";
import { User } from "./index.js";
import {generateAccessToken,generateRefreshToken,} from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import { passwordService } from "./services/password.service.js";
import { dispatchNotificationToAdminsAndOrgs } from "../notification/notification.service.js";

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

const normalizePhone = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[^0-9+]/g, "");
};

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

  const existingUser = await User.findOne({ email }).setOptions({ includeDeleted: true });
  if (existingUser) {
    if (existingUser.isDeleted) {
      // Restore user
      const hashedPassword = await passwordService.hash(password);
      const normalizedPhone = normalizePhone(userData.phone);
      
      const updates = {
        firstName,
        lastName,
        password: hashedPassword,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        status: "ACTIVE",
      };
      if (normalizedPhone) updates.phone = normalizedPhone;
      
      const user = await User.findByIdAndUpdate(existingUser._id, updates, { new: true, includeDeleted: true });
      
      dispatchNotificationToAdminsAndOrgs(user.organizationId || null, {
        title: "Student Registered (Restored)",
        message: `A previously deleted student ${user.firstName} ${user.lastName || ""} has registered again.`,
        type: "SYSTEM",
        link: `/dashboard/students`,
        metadata: { userId: user._id }
      });

      return {
        user,
        accessToken: generateAccessToken({ id: user._id, role: user.role, organizationId: user.organizationId }),
        refreshToken: generateRefreshToken({ id: user._id, role: user.role, organizationId: user.organizationId }),
      };
    } else {
      throw new AuthError("User already exists");
    }
  }

  const normalizedPhone = normalizePhone(userData.phone);
  if (normalizedPhone) {
    const existingPhoneUser = await findUserByPhone(normalizedPhone);
    if (existingPhoneUser) {
      throw new AuthError("Phone number is already in use");
    }
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

  dispatchNotificationToAdminsAndOrgs(user.organizationId || null, {
    title: "New Student Registered",
    message: `A new student ${user.firstName} ${user.lastName || ""} has registered.`,
    type: "SYSTEM",
    link: `/dashboard/students`, // Assuming there is a student list route
    metadata: { userId: user._id }
  });

  return {
    user,
    accessToken: generateAccessToken({ id: user._id, role: user.role, organizationId: user.organizationId }),
    refreshToken: generateRefreshToken({ id: user._id, role: user.role, organizationId: user.organizationId }),
  };
};



//login
export const checkUserExists = async ({ email, phone }) => {
  const normalizedEmail = email ? normalizeEmail(email) : "";
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedEmail && !normalizedPhone) {
    throw new AuthError("Email or phone is required");
  }

  const [emailUser, phoneUser] = await Promise.all([
    normalizedEmail ? findUserByEmail(normalizedEmail) : Promise.resolve(null),
    normalizedPhone ? findUserByPhone(normalizedPhone) : Promise.resolve(null),
  ]);

  const emailExists = Boolean(emailUser);
  const phoneExists = Boolean(phoneUser);

  return {
    exists: emailExists || phoneExists,
    emailExists,
    phoneExists,
    message: emailExists
      ? "A user already exists with this email."
      : phoneExists
      ? "A user already exists with this phone number."
      : "A user already exists with this email or phone number.",
  };
};

export const login = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizeRequiredString(password);

  if (!normalizedEmail || !normalizedPassword) {
    throw new AuthError("Invalid credentials");
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) throw new AuthError("Invalid credentials");

  if (user.status === "SUSPENDED") {
    throw new AuthError("Your account is blocked. Please contact admin.");
  }

  const isMatch = await bcrypt.compare(normalizedPassword, user.password);
  if (!isMatch) throw new AuthError("Invalid credentials");

  return {
    user,
    accessToken: generateAccessToken({ id: user._id, role: user.role, organizationId: user.organizationId }),
    refreshToken: generateRefreshToken({ id: user._id, role: user.role, organizationId: user.organizationId }),
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

  let user = await User.findOne({ firebaseUid: normalizedFirebaseUid }).setOptions({ includeDeleted: true });
  const userFoundByFirebaseUid = !!user; // Track if user was found by firebaseUid
  
  if (!user) {
    user = await User.findOne({ email: normalizedEmail }).setOptions({ includeDeleted: true });
  }

  // Restore the user if they were soft-deleted
  if (user && user.isDeleted) {
    user = await User.findByIdAndUpdate(
      user._id,
      {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        status: "ACTIVE",
      },
      { new: true, includeDeleted: true }
    );
  }

  // Organizations are provisioned by an admin with an email/password login
  // only — block Firebase before the "found by email" branch below, which
  // would otherwise unconditionally overwrite this account's role to STUDENT.
  if (user && user.role === "ORGANIZATION") {
    throw new AuthError("Organizations must log in with email & password, not Google or GitHub.");
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

    dispatchNotificationToAdminsAndOrgs(user.organizationId || null, {
      title: "New Student Registered",
      message: `A new student ${user.firstName} ${user.lastName || ""} has registered via Firebase.`,
      type: "SYSTEM",
      link: `/dashboard/students`,
      metadata: { userId: user._id }
    });
  } else if (userFoundByFirebaseUid) {
    // User already exists with this Firebase UID - don't update the record
    // Just return the existing user for security and consistency
    console.info("Firebase user already signed in, skipping record update", {
      userId: user?._id,
      email: user?.email,
      firebaseUid: user?.firebaseUid,
    });
  } else {
    // User found by email but doesn't have firebaseUid yet - link Firebase account
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

  if (user && user.status === "SUSPENDED") {
    throw new AuthError("Your account is blocked. Please contact admin.");
  }

  const accessToken = generateAccessToken({ id: user._id, role: user.role, organizationId: user.organizationId });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, organizationId: user.organizationId });

  return { user, accessToken, refreshToken, photoURL };
};
export const githubAuth = async (code) => {
  if (!code) {
    throw new AuthError("GitHub authorization code is missing");
  }

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    throw new AuthError("GitHub OAuth credentials are not configured");
  }

  // 1. Exchange code for GitHub access token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_CALLBACK_URL ||
        "http://localhost:5000/auth/github/callback",
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    throw new AuthError(tokenData.error_description || "Failed to get GitHub access token");
  }

  // 2. Get GitHub profile
  const profileResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });

  const profile = await profileResponse.json();

  // 3. Get GitHub email
  const emailsResponse = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });

  const emails = await emailsResponse.json();

  const primaryEmail =
    Array.isArray(emails) ?
    emails.find((email) => email.primary && email.verified) ?.email ||
    emails.find((email) => email.verified) ?.email :
    null;

  const email = normalizeEmail(primaryEmail || profile.email);

  if (!email) {
    throw new AuthError("Could not get verified email from GitHub");
  }

  // 4. Find or create user
  let user = await User.findOne({ email }).setOptions({ includeDeleted: true });

  if (user && user.isDeleted) {
    user = await User.findByIdAndUpdate(
      user._id,
      {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        status: "ACTIVE",
      },
      { new: true, includeDeleted: true }
    );
  }

  // Organizations are provisioned by an admin with an email/password login only.
  if (user && user.role === "ORGANIZATION") {
    throw new AuthError("Organizations must log in with email & password, not Google or GitHub.");
  }

  if (!user) {
    const displayName = profile.name || profile.login || "GitHub User";
    const [derivedFirstName = "Student", ...rest] = displayName.trim().split(" ");
    const derivedLastName = rest.join(" ") || "User";

    const randomPassword = `github:${profile.id}:${Date.now()}`;
    const hashedPassword = await passwordService.hash(randomPassword);

    user = await createUser(
      sanitizeUserCreatePayload({
        firstName: derivedFirstName,
        lastName: derivedLastName,
        email,
        password: hashedPassword,
        role: "STUDENT",
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        lastLogin: new Date(),
        status: "ACTIVE",
      })
    );

    dispatchNotificationToAdminsAndOrgs(user.organizationId || null, {
      title: "New Student Registered",
      message: `A new student ${user.firstName} ${user.lastName || ""} has registered via GitHub.`,
      type: "SYSTEM",
      link: `/dashboard/students`,
      metadata: { userId: user._id }
    });
  } else {
    user = await User.findByIdAndUpdate(
      user._id, {
        lastLogin: new Date(),
        isEmailVerified: true,
        emailVerifiedAt: user.emailVerifiedAt || new Date(),
      }, {
        new: true
      }
    );
  }

  if (user && user.status === "SUSPENDED") {
    throw new AuthError("Your account is blocked. Please contact admin.");
  }

  const accessToken = generateAccessToken({
    id: user._id,
    role: user.role,
    organizationId: user.organizationId
  });
  const refreshToken = generateRefreshToken({
    id: user._id,
    role: user.role,
    organizationId: user.organizationId
  });

  return {
    user,
    accessToken,
    refreshToken
  };
};