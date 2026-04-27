import User from "../../../models/user.model.js";
import { randomPassword } from "../utils/randomPassword.js";
import bcrypt from "bcryptjs";

// Create user
export const createUser = async (data, currentUser) => {
  let plainPassword = data.password;

  // If no password provided or created by Admin/Organization → generate random password
  if (!plainPassword || currentUser.role === "ADMIN" || currentUser.role === "ORGANIZATION") {
    plainPassword = randomPassword();
  }

  // Validate password before hashing
  if (!plainPassword || typeof plainPassword !== "string") {
    throw new Error("Invalid password: password must be a non-empty string");
  }

  // Always hash before saving
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const newUser = new User({
    ...data,
    password: hashedPassword,
    organizationId:
      currentUser.role === "ORGANIZATION"
        ? currentUser.organizationId
        : data.organizationId,
  });

  await newUser.save();

  // Return plain password only once (for onboarding)
  return { user: newUser, plainPassword };
};

// Get user
export const getUserById = async (id, currentUser) => {
  if (currentUser.role === "STUDENT" && currentUser._id.toString() !== id) {
    return null; // student can only see self
  }
  if (currentUser.role === "ORGANIZATION") {
    return await User.findOne({
      _id: id,
      organizationId: currentUser.organizationId,
    });
  }
  return await User.findById(id); // Admin can see anyone
};

// Update user
export const updateUser = async (id, data, currentUser) => {
  if (currentUser.role === "STUDENT" && currentUser._id.toString() !== id) {
    return null;
  }
  if (currentUser.role === "ORGANIZATION") {
    return await User.findOneAndUpdate(
      { _id: id, organizationId: currentUser.organizationId },
      data,
      { new: true }
    );
  }
  return await User.findByIdAndUpdate(id, data, { new: true }); // Admin
};

// Delete user
export const deleteUser = async (id, currentUser) => {
  if (currentUser.role === "STUDENT" && currentUser._id.toString() !== id) {
    return null;
  }
  if (currentUser.role === "ORGANIZATION") {
    return await User.findOneAndDelete({
      _id: id,
      organizationId: currentUser.organizationId,
    });
  }
  return await User.findByIdAndDelete(id); // Admin
};
