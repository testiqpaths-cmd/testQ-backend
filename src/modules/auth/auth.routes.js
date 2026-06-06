import express from "express";
import {
  registerController,
  loginController,
  firebaseAuthController,
  logoutController,
  refreshTokenController,
  meController,
  githubLoginController,
  githubCallbackController,
} from "./auth.controller.js";
import { authMiddleware} from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";

const router = express.Router();

router.post("/register", registerController);
router.post("/login", loginController);
router.post("/firebase", firebaseAuthController);
router.get("/github", githubLoginController);
router.get("/github/callback", githubCallbackController);
router.post("/logout", logoutController);
router.post("/refresh-token", refreshTokenController);
router.get("/me", authMiddleware, meController);

// Example of admin-only route
router.get("/admin", authMiddleware, roleMiddleware("admin"), (req, res) => {
  res.json({ message: "Admin route access granted" });
});

export default router;
