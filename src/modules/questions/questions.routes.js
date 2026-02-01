// modules/questions/questions.routes.js
import { Router } from "express";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import { upload } from "../../common/middlewares/upload.middleware.js";

import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuestionsExcel,
} from "./questions.controller.js";

import { createQuestionSchema } from "./schemas/create-question.schema.js";
import { updateQuestionSchema } from "./schemas/update-question.schema.js";

const router = Router();

router.post("/createManual",  createQuestion);
router.put("/update/:id",  updateQuestion);
router.delete("/delete/:id",  deleteQuestion);
router.post(
  "/upload-excel",
  upload.single("file"),
  uploadQuestionsExcel
);

export default router;
