// modules/questions/questions.routes.js
import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import { upload } from "../../common/middlewares/upload.middleware.js";
import { generateQuestionTemplate } from "./templates/generate-template.js";
import { 
  getAllQuestionsController, 
  getQuestionsByUserIdController, 
  getQuestionByIdController,
  getQuestionsBySubjectController,
  getQuestionsByTopicController 
} from "./questions.controller.js";
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuestionsExcel,
  getMyExcelBatchesController,
  getQuestionsByExcelBatchController,
} from "./questions.controller.js";

import { createQuestionSchema } from "./schemas/create-question.schema.js";
import { updateQuestionSchema } from "./schemas/update-question.schema.js";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.post("/createManual", authMiddleware, validate(createQuestionSchema), createQuestion);
router.put("/update/:id", authMiddleware, validate(updateQuestionSchema), updateQuestion);
router.delete("/delete/:id",authMiddleware, deleteQuestion);
router.post(
  "/upload-excel",
  authMiddleware,
  upload.single("file"),
  uploadQuestionsExcel
);
router.get("/excel-batches/my", authMiddleware, getMyExcelBatchesController);
router.get("/excel-batches/:batchId/questions", authMiddleware, getQuestionsByExcelBatchController);

router.get("/getAllQuestion", getAllQuestionsController);
router.get("/getQuestionsByUser/:userId", getQuestionsByUserIdController);
router.get("/getQuestionById/:questionId", getQuestionByIdController);
router.get("/getQuestionsBySubject/:subjectId", getQuestionsBySubjectController);
router.get("/getQuestionsByTopic/:topicId", getQuestionsByTopicController);

router.get("/download-template", async (req, res) => {
  try {
    // Generate template if it doesn't exist
    const templatePath = await generateQuestionTemplate();

    res.download(templatePath, "question_template.xlsx", (err) => {
      if (err) {
        console.error("Download error:", err);
        res.status(500).json({
          message: "File not found or error downloading template",
        });
      }
    });
  } catch (error) {
    console.error("Error in download-template route:", error);
    res.status(500).json({
      message: "Error generating or downloading template",
      error: error.message,
    });
  }
});

export default router;