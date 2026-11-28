import multer from "multer";
import { ApiError } from "../../../common/exceptions/ApiError.js";

// Formats the parser can actually extract text from (resume-parser.service.js).
// Legacy Word .doc is binary and has no extractor installed, so it is
// rejected here with a clear message instead of failing later in parsing.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt"]);

export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    const extension = (file.originalname || "").split(".").pop().toLowerCase();
    if (extension === "doc" || file.mimetype === "application/msword") {
      cb(
        new ApiError(
          400,
          "Legacy Word .doc files aren't supported. Please save your resume as PDF or DOCX and upload it again."
        ),
        false
      );
    } else if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(extension)) {
      cb(null, true);
    } else {
      cb(
        new ApiError(
          400,
          `Invalid resume file type (.${extension}). Only PDF, DOCX, and TXT are allowed.`
        ),
        false
      );
    }
  },
});

export default resumeUpload;
