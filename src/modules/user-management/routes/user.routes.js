import express from "express";
import {
  createUser,
  getUser,
  updateUser,
  deleteUser,
} from "../controllers/user.controller.js";
import { rbacAccess } from "../../../common/middlewares/rbac.js";
import { authMiddleware } from "../../../common/middlewares/auth.middleware.js";
import * as userService from "../services/user.service.js";

const router = express.Router();

router.get("/:id", authMiddleware, rbacAccess(), getUser);
router.put("/:id", authMiddleware, rbacAccess(), updateUser);
router.delete("/:id", authMiddleware, rbacAccess(), deleteUser);
router.post("/", authMiddleware, rbacAccess(), createUser);

router.get("/", authMiddleware, rbacAccess(), async (req, res, next) => {
  try {
    const users = await userService.listUsers(req.accessFilter);
    res.json({ success: true, users });
  } catch (err) {
    next(err); // Pass to global error handler
  }
});

export default router;
