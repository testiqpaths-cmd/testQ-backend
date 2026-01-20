import express from "express";
import { registerController, loginController, logoutController, refreshTokenController, meController, registerverify,generateOtpController , verifyOtpController } from "./auth.controller.js";
import { authMiddleware, roleMiddleware } from "../../common/middlewares/auth.middleware.js";
// import { register } from "./auth.controller.js";
const router = express.Router();

router.post("/register", registerController);
router.post("/login", loginController);
router.post("/logout", logoutController);
router.post("/refresh-token", refreshTokenController);
router.get("/me", authMiddleware, meController);
router.post("/generate-otp/:id", generateOtpController);
router.post("/verify-otp", verifyOtpController);

// router.post("/register", register);
router.post("/registerverify",registerverify);

// Example of admin-only route
router.get("/admin", authMiddleware, roleMiddleware("admin"), (req, res) => {
  res.json({ message: "Admin route access granted" });
});

export default router;
