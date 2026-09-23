from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from ultralytics import YOLO
from PIL import Image
import io


# ============================================================
# Configuration
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "best.pt"

CONFIDENCE_THRESHOLD = 0.50
IOU_THRESHOLD = 0.45

# Change this if your trained model uses a different class name.
PHONE_CLASS_NAME = "phone"


# ============================================================
# Load YOLO Model
# ============================================================

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Model file not found: {MODEL_PATH}\n"
        "Place best.pt inside the same folder as phone_detector.py"
    )

model = YOLO(str(MODEL_PATH))


# ============================================================
# FastAPI Application
# ============================================================

app = FastAPI(
    title="TestQ Phone Detection API",
    description="YOLO-based phone detection service for TestQ",
    version="1.0.0",
)


# ============================================================
# Phone Detection Function
# ============================================================

def detect_phone(image: Image.Image) -> dict:
    """
    Detect phones in an image using the trained YOLO model.
    """

    # Convert image to RGB
    image = image.convert("RGB")

    # Run YOLO inference
    results = model.predict(
        source=image,
        conf=CONFIDENCE_THRESHOLD,
        iou=IOU_THRESHOLD,
        verbose=False,
    )

    detections = []

    for result in results:

        if result.boxes is None:
            continue

        boxes = result.boxes

        for i in range(len(boxes)):

            confidence = float(boxes.conf[i])
            class_id = int(boxes.cls[i])

            # Get class name from model
            class_name = model.names.get(
                class_id,
                str(class_id)
            )

            # Bounding box
            x1, y1, x2, y2 = boxes.xyxy[i].tolist()

            detections.append({
                "class_id": class_id,
                "class_name": class_name,
                "confidence": round(confidence, 4),
                "bbox": {
                    "x1": round(x1, 2),
                    "y1": round(y1, 2),
                    "x2": round(x2, 2),
                    "y2": round(y2, 2),
                }
            })

    # Check whether phone was detected
    phone_detections = [
        detection
        for detection in detections
        if detection["class_name"].lower() == PHONE_CLASS_NAME
    ]

    phone_detected = len(phone_detections) > 0

    highest_confidence: Optional[float] = None

    if phone_detections:
        highest_confidence = max(
            detection["confidence"]
            for detection in phone_detections
        )

    return {
        "phone_detected": phone_detected,
        "confidence": highest_confidence,
        "count": len(phone_detections),
        "detections": phone_detections,
    }


# ============================================================
# Health Check
# ============================================================

@app.get("/")
def root():
    return {
        "status": "running",
        "service": "TestQ Phone Detection API",
        "model": "best.pt",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
    }


# ============================================================
# Image Detection API
# ============================================================

@app.post("/detect-phone")
async def detect_phone_api(
    file: UploadFile = File(...)
):
    """
    Receive an image from the MERN frontend/backend
    and detect whether a phone is present.
    """

    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a valid image file."
        )

    try:
        # Read uploaded file
        contents = await file.read()

        # Convert bytes to PIL image
        image = Image.open(io.BytesIO(contents))

        # Detect phone
        result = detect_phone(image)

        return result

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Phone detection failed: {str(error)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("phone_detector:app", host="127.0.0.1", port=8000, reload=True)