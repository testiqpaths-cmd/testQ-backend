import path from "path";
import { fileURLToPath } from "url";
import * as ort from "onnxruntime-node";
import { Jimp } from "jimp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Configuration
// ============================================================
const MODEL_PATH = path.resolve(__dirname, "../../ml/best.onnx");
const MODEL_WIDTH = 640;
const MODEL_HEIGHT = 640;
const CONFIDENCE_THRESHOLD = 0.50;
const IOU_THRESHOLD = 0.45;
const PHONE_CLASS_NAME = "phone";

let session = null;

/**
 * Lazily loads the ONNX session once and caches it in memory.
 */
async function getSession() {
  if (!session) {
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
  }
  return session;
}

/**
 * Calculates Intersection-over-Union (IoU) between two bounding boxes.
 */
function calculateIoU(boxA, boxB) {
  const xA = Math.max(boxA.x1, boxB.x1);
  const yA = Math.max(boxA.y1, boxB.y1);
  const xB = Math.min(boxA.x2, boxB.x2);
  const yB = Math.min(boxA.y2, boxB.y2);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
  const boxBArea = (boxB.x2 - boxB.x1) * (boxB.y2 - boxB.y1);

  const unionArea = boxAArea + boxBArea - interArea;
  return unionArea <= 0 ? 0 : interArea / unionArea;
}

/**
 * Performs Non-Maximum Suppression (NMS) on candidates.
 */
function applyNMS(candidates, iouThreshold) {
  candidates.sort((a, b) => b.confidence - a.confidence);

  const selected = [];
  while (candidates.length > 0) {
    const current = candidates.shift();
    selected.push(current);

    candidates = candidates.filter(
      (candidate) => calculateIoU(current.bbox, candidate.bbox) < iouThreshold
    );
  }

  return selected;
}

/**
 * Preprocesses an image with letterboxing to 640x640 RGB Float32 tensor.
 *
 * @param {Buffer} imageBuffer - Raw image buffer
 */
async function preprocessImage(imageBuffer) {
  const image = await Jimp.read(imageBuffer);
  const origWidth = image.bitmap.width;
  const origHeight = image.bitmap.height;

  // Compute scale and padding (Letterbox)
  const scale = Math.min(MODEL_WIDTH / origWidth, MODEL_HEIGHT / origHeight);
  const scaledWidth = Math.round(origWidth * scale);
  const scaledHeight = Math.round(origHeight * scale);

  image.resize({ w: scaledWidth, h: scaledHeight });

  const padX = Math.floor((MODEL_WIDTH - scaledWidth) / 2);
  const padY = Math.floor((MODEL_HEIGHT - scaledHeight) / 2);

  // Create 640x640 canvas filled with standard YOLO gray padding (114, 114, 114)
  const canvas = new Jimp({
    width: MODEL_WIDTH,
    height: MODEL_HEIGHT,
    color: 0x727272ff,
  });

  canvas.composite(image, padX, padY);

  // Convert HWC (RGBA buffer) -> CHW normalized [0.0 - 1.0]
  const planeSize = MODEL_WIDTH * MODEL_HEIGHT;
  const float32Array = new Float32Array(3 * planeSize);
  const rawData = canvas.bitmap.data;

  for (let i = 0; i < planeSize; i++) {
    const offset = i * 4;
    float32Array[i] = rawData[offset] / 255.0; // Channel R
    float32Array[planeSize + i] = rawData[offset + 1] / 255.0; // Channel G
    float32Array[2 * planeSize + i] = rawData[offset + 2] / 255.0; // Channel B
  }

  const tensor = new ort.Tensor("float32", float32Array, [
    1,
    3,
    MODEL_HEIGHT,
    MODEL_WIDTH,
  ]);

  return { tensor, scale, padX, padY, origWidth, origHeight };
}

/**
 * Detects mobile phones in an image buffer using in-process YOLO ONNX runtime.
 *
 * @param {Buffer} imageBuffer - Image data
 * @param {string} [filename="frame.jpg"] - Original filename
 * @param {string} [mimetype="image/jpeg"] - Image MIME type
 */
export const detectPhone = async (
  imageBuffer,
  filename = "frame.jpg",
  mimetype = "image/jpeg"
) => {
  try {
    const ortSession = await getSession();
    const { tensor, scale, padX, padY, origWidth, origHeight } =
      await preprocessImage(imageBuffer);

    // Run inference
    const inputName = ortSession.inputNames[0] || "images";
    const outputs = await ortSession.run({ [inputName]: tensor });
    const outputName = ortSession.outputNames[0] || "output0";
    const outputTensor = outputs[outputName];

    // YOLO11 1-class output shape: [1, 5, 8400]
    const [batch, rows, numAnchors] = outputTensor.dims;
    const outputData = outputTensor.data;

    const candidates = [];

    // Parse all 8400 anchor predictions
    for (let j = 0; j < numAnchors; j++) {
      const confidence = outputData[4 * numAnchors + j]; // 5th row: phone confidence
      if (confidence < CONFIDENCE_THRESHOLD) continue;

      const cx = outputData[0 * numAnchors + j];
      const cy = outputData[1 * numAnchors + j];
      const w = outputData[2 * numAnchors + j];
      const h = outputData[3 * numAnchors + j];

      // Convert from 640x640 padded letterbox space back to original image coordinates
      let x1 = (cx - w / 2 - padX) / scale;
      let y1 = (cy - h / 2 - padY) / scale;
      let x2 = (cx + w / 2 - padX) / scale;
      let y2 = (cy + h / 2 - padY) / scale;

      // Clamp coordinates to image boundaries
      x1 = Math.max(0, Math.min(origWidth, x1));
      y1 = Math.max(0, Math.min(origHeight, y1));
      x2 = Math.max(0, Math.min(origWidth, x2));
      y2 = Math.max(0, Math.min(origHeight, y2));

      candidates.push({
        class_id: 0,
        class_name: PHONE_CLASS_NAME,
        confidence: Number(confidence.toFixed(4)),
        bbox: {
          x1: Number(x1.toFixed(2)),
          y1: Number(y1.toFixed(2)),
          x2: Number(x2.toFixed(2)),
          y2: Number(y2.toFixed(2)),
        },
      });
    }

    // Apply Non-Maximum Suppression to remove duplicate overlapping boxes
    const phoneDetections = applyNMS(candidates, IOU_THRESHOLD);
    const phoneDetected = phoneDetections.length > 0;

    let highestConfidence = null;
    if (phoneDetected) {
      highestConfidence = Math.max(...phoneDetections.map((d) => d.confidence));
      console.log(`📱 [PHONE DETECTED] Count: ${phoneDetections.length} | Confidence: ${(highestConfidence * 100).toFixed(1)}%`);
    }

    // Match exact response structure expected by frontend
    return {
      phone_detected: phoneDetected,
      confidence: highestConfidence,
      count: phoneDetections.length,
      detections: phoneDetections,
    };
  } catch (error) {
    console.error("ONNX Phone detection service error:", error);
    throw new Error("Phone detection service unavailable");
  }
};