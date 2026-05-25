import os
import cv2
import numpy as np
import easyocr
import tempfile
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from PIL import Image
import io
import base64
from deep_sort_realtime.deepsort_tracker import DeepSort

app = FastAPI(title="AI Traffic Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

vehicle_model = YOLO('yolov8n.pt') 
plate_model = YOLO('license_plate_detector.pt')

reader = easyocr.Reader(['en'])

# Từ điển ánh xạ để chuyển đổi ký tự từ repo detect_license_plate_and_OCR
dict_char_to_int = {'O': '0', 'I': '1', 'J': '3', 'A': '4', 'G': '6', 'S': '5'}
dict_int_to_char = {'0': 'O', '1': 'I', '3': 'J', '4': 'A', '6': 'G', '5': 'S'}

def preprocess_plate(crop):
    """
    Tiền xử lý nâng cao: Phóng to 2x Cubic + Chuyển sang ảnh xám (Tốt nhất cho OCR)
    """
    h, w = crop.shape[:2]
    if h == 0 or w == 0:
        return None
    
    # Phóng to 2.0x với CUBIC (Tốt nhất cho OCR)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (int(w * 2), int(h * 2)), interpolation=cv2.INTER_CUBIC)
    
    return resized

def read_license_plate(processed_crop):
    """
    OCR nâng cao: Dùng chế độ đoạn văn để xử lý biển số nhiều dòng (như xe máy).
    """
    if processed_crop is None:
        return None, 0

    # Nhận diện OCR với danh sách ký tự cho phép và chế độ đoạn văn
    # paragraph=True giúp liên kết các ký tự trên nhiều dòng lại với nhau
    detections = reader.readtext(processed_crop, 
                                 allowlist='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                                 paragraph=True,
                                 mag_ratio=2.0)
    
    if not detections:
        return None, 0

    # Sắp xếp các nhận diện theo toạ độ Y để hỗ trợ biển số nhiều dòng
    detections.sort(key=lambda x: x[0][0][1])
    
    all_text = []
    avg_score = 0
    
    for detection in detections:
        # Dưới chế độ đoạn văn, nhận diện là (bbox, text) hoặc (bbox, text, score)
        if len(detection) == 3:
            bbox, text, score = detection
        else:
            bbox, text = detection
            score = 0.9 # Mặc định
            
        # Làm sạch: chỉ giữ lại chữ cái và số
        text = "".join([c for c in text.upper() if c.isalnum()])
        if len(text) >= 2:
            all_text.append(text)
            avg_score += score
            
    if not all_text:
        return None, 0
        
    final_text = "-".join(all_text)
    final_score = avg_score / len(all_text)
    
    return final_text, final_score

def get_best_plate_for_vehicle(vehicle_bbox, plate_detections):
    vx1, vy1, vx2, vy2 = vehicle_bbox
    vy2_extended = vy2 + int((vy2 - vy1) * 0.1)
    best_plate, max_score = None, -1

    for plate in plate_detections:
        px1, py1, px2, py2 = plate['bbox']
        # Tính diện tích phần giao nhau
        ix1, iy1 = max(vx1, px1), max(vy1, py1)
        ix2, iy2 = min(vx2, px2), min(vy2_extended, py2)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        plate_area = max(1, (px2 - px1) * (py2 - py1))
        overlap = inter / plate_area 
        
        # Ngưỡng chồng lấp
        if overlap > 0.4:
            # Kết hợp độ chồng lấp và độ tin cậy để khớp tốt hơn
            score = overlap * plate['conf']
            if score > max_score:
                max_score = score
                best_plate = plate['bbox']

    return best_plate

@app.get("/")
async def root():
    return {"message": "AI Traffic Analysis API is running"}

@app.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        # Nhận diện phương tiện
        vehicle_results = vehicle_model(img)
        
        # Nhận diện biển số trên toàn bộ ảnh
        plate_results = plate_model(img)
        all_plates = []
        for result in plate_results:
            for box in result.boxes:
                conf = float(box.conf[0])
                if conf > 0.2:
                    all_plates.append({
                        "bbox": list(map(int, box.xyxy[0])),
                        "conf": conf
                    })
        
        if all_plates:
            print(f"DEBUG: Found {len(all_plates)} plates in image.")
            for i, p in enumerate(all_plates):
                print(f"  - Plate {i}: Conf {p['conf']:.2f}, Bbox {p['bbox']}")
        
        detections = []
        for result in vehicle_results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                label = vehicle_model.names[class_id]
                
                # Kiểm tra độ tin cậy (0.45) và kích thước (30x30) nghiêm ngặt hơn
                v_x1, v_y1, v_x2, v_y2 = map(int, box.xyxy[0])
                vw, vh = v_x2 - v_x1, v_y2 - v_y1
                
                if label in ['car', 'motorcycle', 'bus', 'truck'] and confidence > 0.3 and vw > 15 and vh > 15:
                    label_vn = {'car': 'Ô tô', 'motorcycle': 'Xe máy', 'bus': 'Xe buýt', 'truck': 'Xe tải'}.get(label, label)
                    
                    # 3. Khớp biển số với phương tiện
                    plate_bbox = get_best_plate_for_vehicle([v_x1, v_y1, v_x2, v_y2], all_plates)
                    
                    plate_text = None
                    plate_crop_base64 = None
                    if plate_bbox:
                        p_x1, p_y1, p_x2, p_y2 = plate_bbox
                        # Cắt vùng biển số với một lề nhỏ
                        plate_crop = img[max(0, p_y1-2):min(img.shape[0], p_y2+2), 
                                         max(0, p_x1-2):min(img.shape[1], p_x2+2)]
                        
                        if plate_crop.size > 0:
                            processed = preprocess_plate(plate_crop)
                            if processed is not None:
                                # Mã hóa ảnh để hiển thị debug
                                _, buffer = cv2.imencode('.jpg', processed)
                                plate_crop_base64 = base64.b64encode(buffer).decode('utf-8')
                                
                                ocr_text, ocr_score = read_license_plate(processed)
                                if ocr_text:
                                    plate_text = ocr_text.upper()

                    detections.append({
                        "type": str(label_vn),
                        "confidence": float(confidence),
                        "bbox": {"x": int(v_x1), "y": int(v_y1), "width": int(v_x2 - v_x1), "height": int(v_y2 - v_y1)},
                        "plate_text": str(plate_text) if plate_text else "[Không rõ]",
                        "plate_crop": plate_crop_base64,
                        "plate_bbox": {"x": int(plate_bbox[0]), "y": int(plate_bbox[1]), "width": int(plate_bbox[2] - plate_bbox[0]), "height": int(plate_bbox[3] - plate_bbox[1])} if plate_bbox else None
                    })

        return {"status": "success", "detections": detections}

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze-video")
async def analyze_video(file: UploadFile = File(...)):
    if not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_file:
        shutil.copyfileobj(file.file, tmp_file)
        tmp_path = tmp_file.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        sample_rate_seconds = 0.1
        frame_interval = max(1, int(fps * sample_rate_seconds))
        
        tracker = DeepSort(max_age=8, n_init=2, nms_max_overlap=0.5, max_cosine_distance=0.3)
        # track_id -> {text: chuỗi, processed: boolean, frames_seen: số nguyên, crop: base64}
        track_plate_memory = {}
        
        video_results = []
        frame_count = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_count % frame_interval == 0:
                timestamp = frame_count / fps
                
                # Nhận diện phương tiện bằng YOLO
                v_results = vehicle_model(frame, verbose=False)
                
                # Định dạng nhận diện cho DeepSORT: [ [left, top, width, height], conf, label ]
                ds_detections = []
                for res in v_results:
                    for box in res.boxes:
                        label = vehicle_model.names[int(box.cls[0])]
                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        vw, vh = x2 - x1, y2 - y1
                        
                        if label in ['car', 'motorcycle', 'bus', 'truck'] and conf > 0.3 and vw > 15 and vh > 15:
                            ds_detections.append([[x1, y1, vw, vh], conf, label])
                
                # Cập nhật bộ theo dõi (Tracker)
                tracks = tracker.update_tracks(ds_detections, frame=frame)
                
                # Nhận diện biển số
                p_results = plate_model(frame, verbose=False)
                all_plates = []
                for res in p_results:
                    for box in res.boxes:
                        conf = float(box.conf[0])
                        if conf > 0.2:
                            all_plates.append({
                                "bbox": list(map(int, box.xyxy[0])),
                                "conf": conf
                            })
                
                if all_plates:
                    print(f"DEBUG [Frame {frame_count}]: Found {len(all_plates)} plates")
                
                frame_detections = []
                for track in tracks:
                    if not track.is_confirmed():
                        continue
                        
                    track_id = track.track_id
                    # Lấy bbox theo định dạng [trái, trên, phải, dưới]
                    v_x1, v_y1, v_x2, v_y2 = map(int, track.to_ltrb())
                    
                    label_vn = {'car': 'Ô tô', 'motorcycle': 'Xe máy', 'bus': 'Xe buýt', 'truck': 'Xe tải'}.get(track.get_det_class(), track.get_det_class())
                    
                    # Kiểm tra xem đã thử OCR cho track này chưa
                    # Bộ nhớ lưu trữ: {"text": chuỗi, "processed": boolean, "frames_seen": số nguyên, "crop": base64}
                    mem = track_plate_memory.get(track_id, {"text": "[Không rõ]", "processed": False, "frames_seen": 0, "crop": None})
                    mem["frames_seen"] += 1
                    track_plate_memory[track_id] = mem
                    
                    plate_text = mem["text"]
                    plate_crop_base64 = mem["crop"]
                    
                    # Tìm plate_bbox mỗi frame để vẽ bounding box real-time
                    current_plate_bbox = get_best_plate_for_vehicle([v_x1, v_y1, v_x2, v_y2], all_plates)
                    plate_bbox_response = None
                    if current_plate_bbox:
                        pb_x1, pb_y1, pb_x2, pb_y2 = current_plate_bbox
                        plate_bbox_response = {"x": pb_x1, "y": pb_y1, "width": pb_x2 - pb_x1, "height": pb_y2 - pb_y1}

                    # OCR một lần cho mỗi xe ổn định
                    if not mem["processed"]:
                        plate_bbox = get_best_plate_for_vehicle([v_x1, v_y1, v_x2, v_y2], all_plates)
                        
                        if plate_bbox:
                            p_x1, p_y1, p_x2, p_y2 = plate_bbox
                            # Kiểm tra chất lượng: ngưỡng kích thước cơ bản
                            if (p_x2 - p_x1) > 20 and (p_y2 - p_y1) > 10:
                                    plate_crop = frame[max(0, p_y1-2):min(frame.shape[0], p_y2+2), 
                                                       max(0, p_x1-2):min(frame.shape[1], p_x2+2)]
                                    
                                    if plate_crop.size > 0:
                                        processed = preprocess_plate(plate_crop)
                                        if processed is not None:
                                            # Mã hóa ảnh để hiển thị debug
                                            _, buffer = cv2.imencode('.jpg', processed)
                                            plate_crop_base64 = base64.b64encode(buffer).decode('utf-8')
                                            track_plate_memory[track_id]["crop"] = plate_crop_base64
                                            
                                            plate_text, plate_score = read_license_plate(processed)
                                            if plate_text:
                                                track_plate_memory[track_id]["text"] = plate_text
                                                track_plate_memory[track_id]["processed"] = True
                                            else:
                                                # Đã thử OCR nhưng thất bại - đánh dấu đã xử lý
                                                track_plate_memory[track_id]["processed"] = True
                        
                        # Nếu đã thấy 15 khung hình mà vẫn không có biển số, đánh dấu đã xử lý [Không rõ]
                        if mem["frames_seen"] >= 15 and not mem["processed"]:
                            track_plate_memory[track_id]["processed"] = True

                    frame_detections.append({
                        "id": f"track_{track_id}",
                        "track_id": track_id,
                        "type": label_vn,
                        "confidence": float(track.det_conf or 0.8),
                        "bbox": {"x": v_x1, "y": v_y1, "width": v_x2 - v_x1, "height": v_y2 - v_y1},
                        "plate_text": plate_text,
                        "plate_crop": plate_crop_base64,
                        "plate_bbox": plate_bbox_response
                    })
                
                video_results.append({
                    "timestamp": timestamp,
                    "detections": frame_detections
                })
            
            frame_count += 1
            if frame_count / fps > 60:
                break

        cap.release()
        
        return {"status": "success", "duration": duration, "results": video_results}

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

# Lệnh đã dùng để chạy backend:
#cd backend && ./venv/bin/python3 main.py
