import User from "../../../models/user.model.js";

// Admin can fetch all users
export const getAllUsers = async () => {
  try {
    // Exclude sensitive fields like password
    return await User.find({}, { password: 0 });
  } catch (err) {
    throw new Error("Failed to fetch users: " + err.message);
  }
};

// Admin can delete any user
export const deleteUser = async (id) => {
  try {
    return await User.findByIdAndDelete(id);
  } catch (err) {
    throw new Error("Failed to delete user: " + err.message);
  }
};
