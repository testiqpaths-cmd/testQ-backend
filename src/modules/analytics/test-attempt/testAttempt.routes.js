import express from "express";
import { getMyResultsController } from "./testAttempt.controller.js";
import {
  authMiddleware,
  roleMiddleware,
} from "../../../common/middlewares/auth.middleware.js";

const router = express.Router();

router.get(
  "/students/me/results",
  authMiddleware,
  roleMiddleware("STUDENT"),
  getMyResultsController
);

export default router;
