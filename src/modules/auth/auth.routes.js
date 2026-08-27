import express from "express";
import {
  registerController,
  checkUserController,
  loginController,
  exchangeLaunchTokenController,
  firebaseAuthController,
  logoutController,
  refreshTokenController,
  meController,
  githubLoginController,
  githubCallbackController,
  updateProfileController,
} from "./auth.controller.js";
import { authMiddleware} from "../../common/middlewares/auth.middleware.js";
import { roleMiddleware } from "../../common/middlewares/role.middleware.js";

const router = express.Router();

router.post("/register", registerController);
router.post("/check-user", checkUserController);
router.post("/login", loginController);
// No authMiddleware — establishes a session where none exists yet, same
// reasoning as exam-browser's sessionId-bearer routes (see that module's
// claim/heartbeat/security-event routes for the closest precedent).
router.post("/exchange-launch-token", exchangeLaunchTokenController);
router.post("/firebase", firebaseAuthController);
router.get("/github", githubLoginController);
router.get("/github/callback", githubCallbackController);
router.post("/logout", logoutController);
router.post("/refresh-token", refreshTokenController);
router.get("/me", authMiddleware, meController);
router.put("/profile", authMiddleware, updateProfileController);

// Example of admin-only route
router.get("/admin", authMiddleware, roleMiddleware("admin"), (req, res) => {
  res.json({ message: "Admin route access granted" });
});

export default router;
