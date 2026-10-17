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
      // SAFEGUARD: In-process computer vision (YOLO/ONNX) on CPU consumes 600%+ CPU
      // across all server cores and locks up the single-threaded Node.js event loop.
      // Phone detection runs client-side in the browser via TensorFlow.js / Coco-SSD.
      // If server-side detection is not explicitly enabled, return a safe 200 response immediately.
      if (process.env.ENABLE_PHONE_DETECTION !== "true") {
        return res.status(200).json({
          success: true,
          phone_detected: false,
          confidence: null,
          count: 0,
          detections: [],
          message: "Client-side detection active or server detection disabled",
        });
      }

      let imageBuffer = req.file?.buffer;
      let filename = req.file?.originalname || "frame.jpg";
      let mimetype = req.file?.mimetype || "image/jpeg";

      if (!imageBuffer && req.body?.image) {
        const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, "");
        imageBuffer = Buffer.from(base64Data, "base64");
      }

      if (!imageBuffer) {
        return res.status(400).json({
          success: false,
          message: "Image is required (file or base64)",
        });
      }

      const result = await detectPhone(
        imageBuffer,
        filename,
        mimetype
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