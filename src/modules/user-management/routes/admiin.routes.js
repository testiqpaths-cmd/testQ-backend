import express from "express";
import {
  listAllUsers,
  deleteUserByAdmin
} from "../controllers/admin.controller.js";
import { rbacAccess } from "../../../../src/common/middlewares/rbac.js";
import { authMiddleware } from "../../../../src/common/middlewares/auth.middleware.js";

const router = express.Router();

// Admin can view and manage all users
router.get("/users", authMiddleware, rbacAccess("IQPATH_ADMIN"), listAllUsers);
router.delete("/users/:id", authMiddleware, rbacAccess("IQPATH_ADMIN"), deleteUserByAdmin);

export default router;
