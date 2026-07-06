import {
  register as registerService,
  login as loginService,
  firebaseAuth as firebaseAuthService,
  githubAuth as githubAuthService,
  checkUserExists as checkUserExistsService,
} from "./auth.service.js";
import  logger  from "../../config/logger.js";
import {
  accessCookieOptions,
  refreshCookieOptions,
} from "../../config/cookie.js";
import {
  verifyRefreshToken,
  generateAccessToken,
  generateRefreshToken,
} from "../../modules/auth/utils/token.service.js";
import { AuthError } from "../../common/exceptions/AuthError.js";
import { findUserById } from "./repositories/auth.repository.js";

const buildAuthUserResponse = (user) => ({
  id: user._id,
  email: user.email,
  role: user.role,
  firstName: user.firstName,
  lastName: user.lastName,
  firebaseUid: user.firebaseUid,
  status: user.status,
  plan: user.plan,
  isEmailVerified: user.isEmailVerified,
  lastLogin: user.lastLogin,
});


/** Register */
export const registerController = async (req, res) => {
  try {
    logger.debug(`REGISTER BODY: ${JSON.stringify(req.body)}`);
    // Make sure we extract only the fields we need
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      role,
      plan,
      organizationId,
    } = req.body;

    // Call service with clean data
    const { user, accessToken, refreshToken } = await registerService({
      firstName,
      lastName,
      email,
      password,
      phone,
      role,
      plan,
      organizationId,
    });

    res
      .set("Authorization", `Bearer ${accessToken}`)
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .status(201)
      .json({
        success: true,
        message: "Registration successful",
        accessToken,
        refreshToken,
        user: buildAuthUserResponse(user),
      });
  } catch (err) {
    logger.error(`Register error: ${err.message}`);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/** Check existing user by email or phone */
export const checkUserController = async (req, res) => {
  try {
    const { email, phone } = req.body;
    const result = await checkUserExistsService({ email, phone });
    return res.status(200).json(result);
  } catch (err) {
    logger.error(`Check user error: ${err.message}`);
    return res.status(400).json({ success: false, message: err.message });
  }
};

/** Login */
export const loginController = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Call login service
    const { user, accessToken, refreshToken } = await loginService({
      email,
      password,
    });

    // Set cookies
    res
      .set("Authorization", `Bearer ${accessToken}`)
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .status(200)
      .json({
        success: true,
        message: "Login successful",
        accessToken,
        refreshToken,
        user: buildAuthUserResponse(user),
    
  });
}catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.status(401).json({ success: false, message: err.message });
  }
};

/** Firebase login/register */
export const firebaseAuthController = async (req, res) => {
  try {
    const { firebaseUid, email, firstName, lastName, displayName, photoURL } = req.body;

    const { user, accessToken, refreshToken } = await firebaseAuthService({
      firebaseUid,
      email,
      firstName,
      lastName,
      displayName,
      photoURL,
    });

    res
      .set("Authorization", `Bearer ${accessToken}`)
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .status(200)
      .json({
        success: true,
        message: "Firebase authentication successful",
        accessToken,
        refreshToken,
        user: buildAuthUserResponse(user),
      });
  } catch (err) {
    logger.error(`Firebase auth error: ${err.message}`);
    res.status(401).json({ success: false, message: err.message });
  }
};

/** Refresh token */
export const refreshTokenController = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) throw new AuthError("Refresh token missing");

    const decoded = verifyRefreshToken(refreshToken);
    const userId = decoded.id;

    const user = await findUserById(userId);
    if (!user) throw new AuthError("User not found");

    const newAccessToken = generateAccessToken({
      id: user._id,
      role: user.role,
    });
    const newRefreshToken = generateRefreshToken({
      id: user._id,
      role: user.role,
    });

    res
      .set("Authorization", `Bearer ${newAccessToken}`)
      .cookie("accessToken", newAccessToken, accessCookieOptions)
      .cookie("refreshToken", newRefreshToken, refreshCookieOptions)
      .json({
        message: "Access token refreshed",
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Refresh token expired" });
    return res
      .status(401)
      .json({ message: err.message || "Invalid refresh token" });
  }
};

/** Logout */
export const logoutController = (req, res) => {
  res
    .clearCookie("accessToken", accessCookieOptions)
    .clearCookie("refreshToken", refreshCookieOptions)
    .json({ message: "Logged out successfully" });
};

/** /me - get current user */
export const meController = async (req, res) => {
  try {
    const user = await findUserById(req.user._id);
    if (!user) throw new AuthError("User not found");
    res.json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};
export const githubLoginController = (req, res) => {
  try {
    if (!process.env.GITHUB_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        message: "GitHub client ID is not configured",
      });
    }

    const callbackUrl =
      process.env.GITHUB_CALLBACK_URL ||
      "http://localhost:5000/auth/github/callback";

    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: "read:user user:email",
    });

    return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  } catch (err) {
    logger.error(`GitHub login error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Failed to start GitHub authentication",
    });
  }
};

export const githubCallbackController = async (req, res) => {
  try {
    const {
      code
    } = req.query;

    const {
      user,
      accessToken,
      refreshToken
    } = await githubAuthService(code);

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    res
      .set("Authorization", `Bearer ${accessToken}`)
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions);

   const safeUser = encodeURIComponent(JSON.stringify(buildAuthUserResponse(user)));

   return res.redirect(
     `${frontendUrl}/login?accessToken=${accessToken}&refreshToken=${refreshToken}&user=${safeUser}`
   );
  } catch (err) {
    logger.error(`GitHub callback error: ${err.message}`);

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    return res.redirect(
      `${frontendUrl}/login?error=${encodeURIComponent(err.message || "GitHub authentication failed")}`
    );
  }
};

export const updateProfileController = async (req, res) => {
  try {
    const userId = req.user._id;
    const { firstName, lastName, phone, profileImage, education, address } = req.body;
    
    // Import User model dynamically if not imported, or use findUserById from repository
    // Wait, let's just import User at the top. Wait, User is not imported in auth.controller.js!
    // Ah, there is `import { User } from "../auth/index.js";` in user.controller.js.
    // In auth.controller.js there is `import { findUserById } from "./repositories/auth.repository.js";`
    // And also `import UserModel from "../../models/user.model.js"` can be used.
    const UserModel = (await import("../../models/user.model.js")).default;
    
    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (phone !== undefined) updates.phone = phone;
    if (profileImage !== undefined) updates.profileImage = profileImage;
    if (education !== undefined) updates.education = education;
    if (address !== undefined) updates.address = address;

    const user = await UserModel.findByIdAndUpdate(userId, updates, { new: true }).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, message: "Profile updated successfully", user: {
      id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      firebaseUid: user.firebaseUid,
      status: user.status,
      plan: user.plan,
      isEmailVerified: user.isEmailVerified,
      lastLogin: user.lastLogin,
      profileImage: user.profileImage,
      phone: user.phone,
      address: user.address,
      education: user.education
    } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to update profile" });
  }
};
