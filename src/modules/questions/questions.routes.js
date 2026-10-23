// modules/questions/questions.routes.js
import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { authMiddleware } from "../../common/middlewares/auth.middleware.js";
import { featureMiddleware } from "../../common/middlewares/feature.middleware.js";
import { companyWiseFeatureMiddleware } from "../../common/middlewares/companyWiseFeature.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import { upload } from "../../common/middlewares/upload.middleware.js";
import { imageUpload } from "../../common/middlewares/imageUpload.middleware.js";
import { generateQuestionTemplate } from "./templates/generate-template.js";
import { 
  getAllQuestionsController, 
  getQuestionsByUserIdController, 
  getQuestionByIdController,
  getQuestionsBySubjectController,
  getQuestionsByTopicController,
  downloadQuestionTemplateController
} from "./questions.controller.js";
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuestionsExcel,
  uploadQuestionImage,
  getMyExcelBatchesController,
  getQuestionsByExcelBatchController,
} from "./questions.controller.js";

import { createQuestionSchema } from "./schemas/create-question.schema.js";
import { updateQuestionSchema } from "./schemas/update-question.schema.js";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.post("/createManual", authMiddleware, featureMiddleware("QUESTION_BANK", true), validate(createQuestionSchema), createQuestion);
router.put("/update/:id", authMiddleware, featureMiddleware("QUESTION_BANK"), validate(updateQuestionSchema), updateQuestion);
router.delete("/delete/:id",authMiddleware, featureMiddleware("QUESTION_BANK"), deleteQuestion);
router.post(
  "/upload-excel",
  authMiddleware,
  featureMiddleware("QUESTION_BANK", true),
  upload.single("file"),
  uploadQuestionsExcel
);
router.post(
  "/upload-image",
  authMiddleware,
  featureMiddleware("QUESTION_BANK"),
  imageUpload.single("image"),
  uploadQuestionImage
);
router.get("/excel-batches/my", authMiddleware, featureMiddleware("QUESTION_BANK"), getMyExcelBatchesController);
router.get("/excel-batches/:batchId/questions", authMiddleware, featureMiddleware("QUESTION_BANK"), getQuestionsByExcelBatchController);

router.get("/getAllQuestion", authMiddleware, featureMiddleware("QUESTION_BANK"), companyWiseFeatureMiddleware(), getAllQuestionsController);
router.get("/getQuestionsByUser/:userId", authMiddleware, featureMiddleware("QUESTION_BANK"), getQuestionsByUserIdController);
router.get("/getQuestionById/:questionId", authMiddleware, featureMiddleware("QUESTION_BANK"), getQuestionByIdController);
router.get("/getQuestionsBySubject/:subjectId", authMiddleware, featureMiddleware("QUESTION_BANK"), getQuestionsBySubjectController);
router.get("/getQuestionsByTopic/:topicId", authMiddleware, featureMiddleware("QUESTION_BANK"), getQuestionsByTopicController);

// router.get("/download-template", async (req, res) => {
//   try {
//     // Generate template if it doesn't exist
//     const templatePath = await generateQuestionTemplate();

//     res.download(templatePath, "question_template.xlsx", (err) => {
//       if (err) {
//         console.error("Download error:", err);
//         res.status(500).json({
//           message: "File not found or error downloading template",
//         });
//       }
//     });
//   } catch (error) {
//     console.error("Error in download-template route:", error);
//     res.status(500).json({
//       message: "Error generating or downloading template",
//       error: error.message,
//     });
//   }
// });
router.get("/download-template", downloadQuestionTemplateController);

export default router;