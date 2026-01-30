import express from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import questionsRoutes from "../modules/questions/questions.routes.js";

// import userRoutes from "../modules/user/user.routes.js"; // future module

const router = express.Router();

// Health check
router.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

// Auth routes
router.use("/auth", authRoutes);
router.use("/questions", questionsRoutes);

// Other future routes
// router.use("/user", userRoutes);

export default router;
