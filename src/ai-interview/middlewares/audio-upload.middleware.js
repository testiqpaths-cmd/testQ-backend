import multer from "multer";
import { ApiError } from "../../common/exceptions/ApiError.js";

const ALLOWED_EXTENSIONS = new Set([
  "wav",
  "mp3",
  "m4a",
  "mp4",
  "webm",
  "ogg",
  "oga",
  "opus",
  "flac",
  "aac",
]);

export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB — a few minutes of compressed speech
  },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname || "").split(".").pop().toLowerCase();
    if ((file.mimetype || "").startsWith("audio/") || file.mimetype === "video/webm" || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, `Unsupported audio type (.${ext} / ${file.mimetype}).`), false);
    }
  },
});

export default audioUpload;
