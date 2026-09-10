import multer from "multer";
import { ApiError } from "../../common/exceptions/ApiError.js";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt"]);

export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    const extension = (file.originalname || "").split(".").pop().toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(extension)) {
      cb(null, true);
    } else {
      cb(
        new ApiError(
          400,
          `Invalid resume file type (.${extension}). Only PDF, DOC, and DOCX are allowed.`
        ),
        false
      );
    }
  },
});

export default resumeUpload;
