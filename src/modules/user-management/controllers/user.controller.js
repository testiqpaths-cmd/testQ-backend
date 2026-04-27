import * as userService from "../services/user.service.js";
import { validationResult } from "express-validator";

// Create user
export const createUser = async (req, res, next) => {
  try {
    // Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { user, plainPassword } = await userService.createUser(req.body, req.user);

    // Return user without exposing hashed password
    res.status(201).json({
      success: true,
      user,
      // Only return plain password if needed for onboarding (e.g., email to student)
      password: plainPassword,
    });
  } catch (err) {
    next(err); // Pass to global error handler
  }
};

// Get user
export const getUser = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id, req.user);
    if (!user) {
     return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

// Update user
export const updateUser = async (req, res, next) => {
  try {
    const updatedUser = await userService.updateUser(req.params.id, req.body, req.user);
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    next(err);
  }
};

// Delete user
export const deleteUser = async (req, res, next) => {
  try {
    const deletedUser = await userService.deleteUser(req.params.id, req.user);
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, message: "User deleted successfully" });
  } catch (err) {
    next(err);
  }
};
