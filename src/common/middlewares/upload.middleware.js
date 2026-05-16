// src/common/middlewares/upload.middleware.js
import multer from "multer";

// Use memory storage for file uploads
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    // Accept Excel and CSV files
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "text/csv" ||
      file.mimetype === "application/csv"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel and CSV files are allowed"), false);
    }
  },
});
