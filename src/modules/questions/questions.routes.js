// modules/questions/questions.routes.js
import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import { upload } from "../../common/middlewares/upload.middleware.js";
import { getAllQuestionsController , getQuestionsByUserIdController , getQuestionByIdController } from "./questions.controller.js";
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuestionsExcel,
} from "./questions.controller.js";

import { createQuestionSchema } from "./schemas/create-question.schema.js";
import { updateQuestionSchema } from "./schemas/update-question.schema.js";

const router = Router();

router.post("/createManual",authMiddleware, createQuestion);
router.put("/update/:id",authMiddleware, updateQuestion);
router.delete("/delete/:id",authMiddleware, deleteQuestion);
router.post(
  "/upload-excel",
  authMiddleware,
  upload.single("file"),
  uploadQuestionsExcel
);

router.get("/getAllQuestion", getAllQuestionsController);
router.get("/getQuestionsByUser/:userId", getQuestionsByUserIdController);
router.get("/getQuestionById/:questionId", getQuestionByIdController);

export default router;