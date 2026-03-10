import express from "express";
import { generateStudentReport } from "./studentReport.controller.js";
import {
  authMiddleware,
  roleMiddleware,
} from "../../../../common/middlewares/auth.middleware.js";

const router = express.Router();

router.get(
  "/student/results",
  authMiddleware,
 roleMiddleware("STUDENT"),
  generateStudentReport
);

export default router;
