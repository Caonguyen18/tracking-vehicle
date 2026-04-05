import cv2
import numpy as np
from ultralytics import YOLO
import easyocr

# Load models
v_model = YOLO('yolov8n.pt')
p_model = YOLO('plate_model.pt')
reader = easyocr.Reader(['en'])

# Find any image in the workspace to test
# Let's try to find a car image or just test with a dummy if none found
img_path = 'test_debug.jpg'
# Create a dummy image if not exists, but better to use a real one.
# I'll just check if there's any jpg/png in the assets
import glob
images = glob.glob('**/*.jpg', recursive=True) + glob.glob('**/*.png', recursive=True)

if not images:
    print("No images found in workspace to test.")
    # Create a blank image to test model loading at least
    img = np.zeros((640, 640, 3), dtype=np.uint8)
else:
    img_path = images[0]
    print(f"Testing with: {img_path}")
    img = cv2.imread(img_path)

if img is not None:
    # 1. Vehicle Detection
    v_results = v_model(img, verbose=False)
    print(f"Vehicles detected: {len(v_results[0].boxes)}")
    for box in v_results[0].boxes:
        print(f"  - {v_model.names[int(box.cls[0])]} conf: {float(box.conf[0]):.2f}")

    # 2. Plate Detection
    p_results = p_model(img, verbose=False)
    print(f"Plates detected: {len(p_results[0].boxes)}")
    for box in p_results[0].boxes:
        print(f"  - conf: {float(box.conf[0]):.2f} box: {box.xyxy[0].tolist()}")
        
        # Test OCR
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        plate_crop = img[y1:y2, x1:x2]
        if plate_crop.size > 0:
            ocr = reader.readtext(plate_crop)
            print(f"    OCR: {ocr}")
else:
    print("Failed to load image.")
