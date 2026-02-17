import express from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import questionsRoutes from "../modules/questions/questions.routes.js";
import testRoutes from "../modules/test-management/test.routes.js";
// import userRoutes from "../modules/user/user.routes.js"; // future module
import testSeriesRoutes from "../modules/test-management/testSeries.routes.js";
import testAttemptRoutes from "../modules/analytics/test-attempt/testAttempt.routes.js";
import testStatsRoutes from "../modules/analytics/test-statistics/testStats.routes.js";
import organizationRoutes from "../modules/analytics/organization/organization.routes.js";
import adminRoutes from "../modules/analytics/admin-analytics/admin.routes.js";
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


 // Test management routes
 router.use("/test", testRoutes);


//test-series
router.use("/test-series", testSeriesRoutes);


// testattempt
router.use("/results",testAttemptRoutes);

//testStats
router.use("/analytics",testStatsRoutes);

//Organization Analystics
router.use("/organizations", organizationRoutes);

//IQ-pathAdmin Analystics
router.use("/admin", adminRoutes);

export default router;




