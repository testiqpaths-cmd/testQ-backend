import * as adminService from "../services/admin.service.js";

export const listAllUsers = async (req, res, next) => {
  try {
    const users = await adminService.getAllUsers();
    res.json({ success: true, users });
  } catch (err) {
    next(err); // Pass to global error handler
  }
};

export const deleteUserByAdmin = async (req, res, next) => {
  try {
    const deletedUser = await adminService.deleteUser(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, message: "User deleted successfully" });
  } catch (err) {
    next(err);
  }
};
