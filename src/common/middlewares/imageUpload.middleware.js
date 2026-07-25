// src/common/middlewares/imageUpload.middleware.js
import multer from "multer";

const ALLOWED_MIMETYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Memory storage — the buffer is converted to a data URI and streamed
// straight to Cloudinary, never written to local disk.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WEBP or GIF images are allowed"), false);
    }
  },
});
