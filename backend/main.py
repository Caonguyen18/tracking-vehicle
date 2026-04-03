import os
import cv2
import numpy as np
import easyocr
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from PIL import Image
import io

app = FastAPI(title="AI Traffic Analysis API")

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize models
# Load YOLOv8/v11 models (these will be downloaded automatically by ultralytics)
# yolov8n.pt for general purpose detection (vehicles)
# You might need a specialized model for License Plates, but let's start with a general one or a custom one if available.
vehicle_model = YOLO('yolov8n.pt') 
# For license plate detection, we'll try to find a specialized model or use general detection if it's capable.
# For now, let's assume we use the same or a specific one if known.
# plate_model = YOLO('license_plate_detector.pt') # Placeholder for specialized LP model

# Initialize EasyOCR
reader = easyocr.Reader(['en'])

@app.get("/")
async def root():
    return {"message": "AI Traffic Analysis API is running"}

@app.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    try:
        # Read image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        # Run Vehicle Detection
        results = vehicle_model(img)
        
        detections = []
        for result in results:
            for box in result.boxes:
                # Class mapping: car (2), motorcycle (3), bus (5), truck (7) in COCO
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                label = vehicle_model.names[class_id]
                
                # Filter for vehicles
                if label in ['car', 'motorcycle', 'bus', 'truck']:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    
                    # Translate label
                    label_vn = {
                        'car': 'Ô tô',
                        'motorcycle': 'Xe máy',
                        'bus': 'Xe buýt',
                        'truck': 'Xe tải'
                    }.get(label, label)
                    
                    lp_text = "Không xác định"
                    # Focus on bottom part of vehicle where plate usually is
                    crop_h = y2 - y1
                    plate_area = img[y1 + int(crop_h * 0.5):y2, x1:x2]
                    
                    if plate_area.size > 0:
                        ocr_results = reader.readtext(plate_area)
                        if ocr_results:
                            # Join all detected text pieces
                            detected_text = " ".join([res[1] for res in ocr_results if res[2] > 0.3]).strip()
                            if detected_text:
                                lp_text = detected_text.upper()

                    detections.append({
                        "type": label_vn,
                        "confidence": confidence,
                        "bbox": [x1, y1, x2, y2],
                        "license_plate": lp_text
                    })

        return {
            "status": "success",
            "detections": detections
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
