import User from "../../../models/user.model.js";

export const getUserCreatedAtByIdRepo = (userId) =>
  User.findById(userId).select("createdAt");

export const getUserByIdRepo = (userId) => User.findById(userId);

export const getAllStudentsRepo = () => User.find({ role: "STUDENT" });
