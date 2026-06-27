import express from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import questionsRoutes from "../modules/questions/questions.routes.js";
import subjectTopicRoutes from "../modules/subject-topic/subject-topic.routes.js";

import testRoutes from "../modules/test-management/test.routes.js";
import userRoutes from "../modules/user/user.routes.js";
import testSeriesRoutes from "../modules/test-management/testSeries.routes.js";
import testAttemptsRoutes from "../modules/test-attempts/testAttempt.routes.js";

import testAttemptRoutes from "../modules/analytics/test-attempt/testAttempt.routes.js";
import testStatsRoutes from "../modules/analytics/test-statistics/testStats.routes.js";
import organizationRoutes from "../modules/analytics/organization/organization.routes.js";
import adminRoutes from "../modules/analytics/admin-analytics/admin.routes.js";
import timeBasedRoutes from "../modules/analytics/time-based-analytics/timeBased.routes.js";
import studentReportRoutes from "../modules/analytics/reports/student/studentReport.routes.js";
import orgReportRoutes from "../modules/analytics/reports/organization/orgReport.routes.js";
import platformReportsRoutes from "../modules/analytics/reports/platform-analytics/platformReports.routes.js";
import leaderboardRoutes from "../modules/leaderboard/leaderboard.routes.js";
import notificationRoutes from "../modules/notification/notification.routes.js";
import helpSupportRoutes from "../modules/help-support/helpSupport.routes.js";
import dashboardRoutes from "../modules/analytics/dashboard/dashboard.routes.js";
const router = express.Router();

// Health check
router.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

// Auth routes
router.use("/auth", authRoutes);
router.use("/questions", questionsRoutes);
router.use("/subject-topic", subjectTopicRoutes);

// Other future routes
router.use("/users", userRoutes);


 // Test management routes
 router.use("/test", testRoutes);


//test-series
router.use("/test-series", testSeriesRoutes);

//test-attempts
router.use("/test-attempts",testAttemptsRoutes);




// testattempt
router.use("/results",testAttemptRoutes);

//testStats
router.use("/analytics",testStatsRoutes);

// Dashboard Analytics
router.use("/dashboard", dashboardRoutes);

//Organization Analystics
router.use("/organizations", organizationRoutes);

//IQ-pathAdmin Analystics
router.use("/admin", adminRoutes);

//time-based analytics
router.use("/trends", timeBasedRoutes);

//student result report
router.use("/reports", studentReportRoutes);

router.use("/reports", orgReportRoutes);

router.use("/reports", platformReportsRoutes);

router.use("/leaderboard", leaderboardRoutes);
router.use("/notifications", notificationRoutes);
router.use("/help-support", helpSupportRoutes);

export default router;




