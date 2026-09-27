import express from "express";
import multer from "multer";
import { detectPhone } from "../services/phoneDetection.service.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post(
  "/detect-phone",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Image file is required",
        });
      }

      const result = await detectPhone(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      return res.status(200).json({
        success: true,
        ...result,
      });

    } catch (error) {
      console.error("Phone detection route error:", error);

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

export default router;