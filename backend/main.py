# ---- Thư viện chuẩn ----
import os
import base64
import tempfile
import shutil
import time
import traceback

# ---- Thư viện bên thứ ba ----
import cv2
import numpy as np
import torch
import easyocr
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort

app = FastAPI(title="AI Traffic Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tự phát hiện thiết bị suy luận:
#  - CUDA (GPU NVIDIA) nếu có
#  - MPS (GPU Apple Silicon) nếu có
#  - ngược lại dùng CPU
# YOLO/ultralytics chạy tốt trên cả CUDA và MPS.
# EasyOCR chỉ bật GPU khi có CUDA (hỗ trợ MPS chưa ổn định) -> tránh lỗi.
HAS_CUDA = torch.cuda.is_available()
HAS_MPS = getattr(torch.backends, 'mps', None) is not None and torch.backends.mps.is_available()
if HAS_CUDA:
    YOLO_DEVICE = 0
elif HAS_MPS:
    YOLO_DEVICE = 'mps'
else:
    YOLO_DEVICE = 'cpu'
EASYOCR_GPU = HAS_CUDA  # chỉ dùng GPU cho OCR khi có CUDA
print(f"[INIT] Thiết bị YOLO: {YOLO_DEVICE} | EasyOCR GPU: {EASYOCR_GPU}")

# ============== THAM SỐ TINH CHỈNH DETECTION ==============
VEHICLE_IMGSZ = 960     # Kích thước ảnh đầu vào cho model xe (mặc định YOLO là 640)
PLATE_IMGSZ = 1280      # Lớn hơn để bắt biển số nhỏ/xa tốt hơn
VEHICLE_CONF = 0.45     # Ngưỡng tin cậy phát hiện xe (cao hơn -> ít box vu vơ)
PLATE_CONF = 0.35       # Ngưỡng tin cậy phát hiện biển số (cao hơn -> bớt nhận nhầm biển hiệu)
MIN_VEHICLE_SIZE = 40   # Kích thước xe tối thiểu (px) -> lọc box nhỏ/xa lộn xộn
NMS_IOU = 0.5           # IoU cho NMS của YOLO (thấp hơn -> bớt box chồng nhau)
VEHICLE_CLASSES = ['car', 'motorcycle', 'bus', 'truck']
# Một số lớp dễ bị nhận nhầm (cột/biển báo -> "xe tải") nên yêu cầu conf cao hơn
STRICT_CLASS_CONF = {'truck': 0.60, 'bus': 0.60}
# Tên loại xe hiển thị bằng tiếng Việt (dùng chung cho cả ảnh và video)
VEHICLE_LABELS_VN = {'car': 'Ô tô', 'motorcycle': 'Xe máy', 'bus': 'Xe buýt', 'truck': 'Xe tải'}
MIN_PLATE_W, MIN_PLATE_H = 20, 10   # Kích thước biển số tối thiểu (px) để OCR
# Video: OCR chỉ chạy MỘT LẦN cho mỗi xe (khi lần đầu thấy biển đủ kích thước)
# ==========================================================

def passes_vehicle_filter(label, conf, w, h):
    """Lọc phát hiện xe: đúng lớp, đủ tin cậy (theo lớp) và đủ lớn."""
    if label not in VEHICLE_CLASSES:
        return False
    min_conf = STRICT_CLASS_CONF.get(label, VEHICLE_CONF)
    return conf >= min_conf and w >= MIN_VEHICLE_SIZE and h >= MIN_VEHICLE_SIZE

# YOLOv8m (Medium) cho phát hiện/phân loại phương tiện — chính xác hơn bản Nano.
# Ưu tiên bản ONNX nếu đã export -> chạy qua ONNX Runtime; ngược lại dùng .pt (PyTorch).
# Cách tạo bản ONNX: `yolo export model=yolov8m.pt format=onnx` và `pip install onnxruntime`.
VEHICLE_WEIGHTS = 'yolov8m.onnx' if os.path.exists('yolov8m.onnx') else 'yolov8m.pt'
vehicle_model = YOLO(VEHICLE_WEIGHTS)
print(f"[INIT] Mô hình phương tiện: {VEHICLE_WEIGHTS}")
plate_model = YOLO('license_plate_detector.pt')

reader = easyocr.Reader(['en'], gpu=EASYOCR_GPU)

# Từ điển ánh xạ để chuyển đổi ký tự từ repo detect_license_plate_and_OCR
dict_char_to_int = {'O': '0', 'I': '1', 'J': '3', 'A': '4', 'G': '6', 'S': '5', 'B': '8', 'Z': '2', 'D': '0'}
dict_int_to_char = {'0': 'O', '1': 'I', '3': 'J', '4': 'A', '6': 'G', '5': 'S', '8': 'B', '2': 'Z'}

def format_vietnam_plate(text):
    """
    Chuẩn hóa theo định dạng biển số Việt Nam: 2 số tỉnh + 1 chữ sêri + dãy số.
    Ví dụ: 51F12345, 30A12345. Sửa nhầm lẫn O<->0, I<->1, B<->8...
    theo vị trí ký tự. Nếu độ dài không hợp lệ thì giữ nguyên text gốc.
    """
    s = "".join(c for c in text.upper() if c.isalnum())
    # Biển VN thường dài 7-9 ký tự (kể cả biển 5 số)
    if len(s) < 7 or len(s) > 9:
        return s
    chars = list(s)
    # Vị trí 0, 1: mã tỉnh -> phải là chữ số
    for i in (0, 1):
        chars[i] = dict_char_to_int.get(chars[i], chars[i])
    # Vị trí 2: ký tự sêri -> phải là chữ cái
    chars[2] = dict_int_to_char.get(chars[2], chars[2])
    # Phần còn lại: dãy số -> phải là chữ số
    for i in range(3, len(chars)):
        chars[i] = dict_char_to_int.get(chars[i], chars[i])
    return "".join(chars)

def order_points(pts):
    """Sắp xếp 4 điểm theo thứ tự: trên-trái, trên-phải, dưới-phải, dưới-trái."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # tổng nhỏ nhất -> trên-trái
    rect[2] = pts[np.argmax(s)]   # tổng lớn nhất -> dưới-phải
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # hiệu nhỏ nhất -> trên-phải
    rect[3] = pts[np.argmax(diff)]  # hiệu lớn nhất -> dưới-trái
    return rect

def warp_plate_perspective(crop):
    """
    Làm thẳng biển số bị chụp chéo bằng Canny + tìm tứ giác + Perspective Transform.
    Nếu không tìm được 4 góc đáng tin cậy thì trả về ảnh gốc (fallback an toàn).
    """
    h, w = crop.shape[:2]
    if h < 15 or w < 15:
        return crop

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    # Nối các cạnh đứt để contour khép kín hơn
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return crop

    # Chọn contour lớn nhất, bỏ nếu quá nhỏ so với ảnh
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.2 * w * h:
        return crop

    # Xấp xỉ đa giác; chỉ xử lý khi đúng 4 góc (tứ giác biển số)
    peri = cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, 0.02 * peri, True)
    if len(approx) != 4:
        return crop

    rect = order_points(approx.reshape(4, 2).astype("float32"))
    (tl, tr, br, bl) = rect
    max_w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    max_h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    if max_w < 15 or max_h < 10:
        return crop

    dst = np.array([[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
                   dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(crop, matrix, (max_w, max_h))

def preprocess_plate(crop):
    """
    Tiền xử lý nâng cao cho OCR:
    Làm thẳng biển chéo (Canny + Perspective) -> phóng to (2-3x) -> ảnh xám
    -> khử nhiễu -> CLAHE tăng tương phản -> làm nét.
    Phóng to mạnh hơn cho biển số rất nhỏ.
    """
    if crop is None or crop.size == 0:
        return None

    # Làm thẳng biển số bị chụp chéo trước khi xử lý
    crop = warp_plate_perspective(crop)

    h, w = crop.shape[:2]
    if h == 0 or w == 0:
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Phóng to: biển càng nhỏ phóng càng mạnh
    scale = 3 if max(h, w) < 100 else 2
    resized = cv2.resize(gray, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)

    # Khử nhiễu nhưng vẫn giữ cạnh chữ
    denoised = cv2.bilateralFilter(resized, 11, 17, 17)

    # CLAHE: cân bằng tương phản cục bộ (tốt với biển bị chói/tối)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    # Làm nét để chữ rõ hơn
    sharpen_kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    sharpened = cv2.filter2D(enhanced, -1, sharpen_kernel)

    return sharpened

def is_plausible_vn_plate(text):
    """
    Kiểm tra chuỗi OCR có giống một biển số Việt Nam thật hay không.
    Biển VN luôn có nhiều chữ số (mã tỉnh + dãy số) và ít nhất một chữ cái sêri.
    Dùng để loại các biển hiệu/chữ trên tường bị nhận nhầm (vd "CƠM" -> "COM").
    """
    s = "".join(c for c in text.upper() if c.isalnum())
    if not (7 <= len(s) <= 10):
        return False
    digits = sum(c.isdigit() for c in s)
    letters = sum(c.isalpha() for c in s)
    return digits >= 4 and letters >= 1

def read_license_plate(processed_crop):
    """
    OCR nâng cao với tham số EasyOCR được tinh chỉnh.
    paragraph=True để gộp các ký tự nhiều dòng (biển xe máy) thành một cụm;
    sau đó sắp xếp theo Y để ghép đúng thứ tự dòng.
    Lưu ý: ở chế độ paragraph, EasyOCR không trả điểm tin cậy nên dùng điểm mặc định.
    Trả về (text đã chuẩn hóa theo định dạng VN, điểm).
    """
    if processed_crop is None:
        return None, 0

    detections = reader.readtext(
        processed_crop,
        allowlist='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        paragraph=True,         # gộp ký tự nhiều dòng lại với nhau
        mag_ratio=1.5,
    )

    if not detections:
        return None, 0

    # Sắp xếp theo toạ độ Y để hỗ trợ biển số nhiều dòng
    detections.sort(key=lambda x: x[0][0][1])

    all_text = []
    total_score = 0.0

    for detection in detections:
        # Ở chế độ paragraph, mỗi phần tử là (bbox, text); không có điểm tin cậy
        if len(detection) == 3:
            bbox, text, score = detection
        else:
            bbox, text = detection
            score = 0.9   # mặc định khi không có điểm
        # Làm sạch: chỉ giữ lại chữ cái và số
        text = "".join([c for c in text.upper() if c.isalnum()])
        if len(text) >= 2:
            all_text.append(text)
            total_score += score

    if not all_text:
        return None, 0

    raw_text = "".join(all_text)
    final_text = format_vietnam_plate(raw_text)

    # Loại kết quả không giống biển số VN (vd biển hiệu "CƠM", logo, số nhà...)
    if not is_plausible_vn_plate(final_text):
        return None, 0

    final_score = total_score / len(all_text)

    return final_text, final_score

def detect_plate_in_region(image, region_bbox, pad_ratio=0.08):
    """
    Two-stage: cắt vùng xe (kèm lề), chạy plate_model với imgsz cao trên vùng đó.
    Biển số chiếm tỉ lệ lớn hơn trong ảnh đầu vào -> dễ phát hiện hơn nhiều.
    Trả về bbox biển số theo toạ độ TOÀN ẢNH (hoặc None).
    """
    vx1, vy1, vx2, vy2 = region_bbox
    H, W = image.shape[:2]
    pw = int((vx2 - vx1) * pad_ratio)
    ph = int((vy2 - vy1) * pad_ratio)
    cx1, cy1 = max(0, vx1 - pw), max(0, vy1 - ph)
    cx2, cy2 = min(W, vx2 + pw), min(H, vy2 + ph)

    crop = image[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return None, 0.0

    results = plate_model(crop, imgsz=PLATE_IMGSZ, conf=PLATE_CONF,
                          device=YOLO_DEVICE, verbose=False)
    best_bbox, best_conf = None, -1.0
    for res in results:
        for box in res.boxes:
            c = float(box.conf[0])
            if c > best_conf:
                px1, py1, px2, py2 = map(int, box.xyxy[0])
                # Quy đổi về toạ độ toàn ảnh
                best_bbox = [cx1 + px1, cy1 + py1, cx1 + px2, cy1 + py2]
                best_conf = c
    return best_bbox, max(0.0, best_conf)

def crop_with_margin(image, x1, y1, x2, y2, margin=2):
    """Cắt một vùng ảnh kèm lề nhỏ, có kẹp trong biên ảnh để khỏi tràn."""
    h, w = image.shape[:2]
    return image[max(0, y1 - margin):min(h, y2 + margin),
                 max(0, x1 - margin):min(w, x2 + margin)]

def get_best_plate_for_vehicle(vehicle_bbox, plate_detections):
    """
    Tìm biển số khớp nhất với một xe dựa trên độ chồng lấp không gian.
    Mở rộng vùng xe xuống dưới 10% (biển thường ở đuôi/đầu xe), rồi chọn biển có
    điểm = (độ chồng lấp) * (độ tin cậy) cao nhất. Trả về bbox biển hoặc None.
    """
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

# ==================== ENDPOINT: PHÂN TÍCH ẢNH ====================
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

        # Nhận diện phương tiện (imgsz cao + ngưỡng conf + NMS truyền thẳng vào model)
        vehicle_results = vehicle_model(img, imgsz=VEHICLE_IMGSZ, conf=VEHICLE_CONF,
                                        iou=NMS_IOU, device=YOLO_DEVICE, verbose=False)

        detections = []
        for result in vehicle_results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                label = vehicle_model.names[class_id]

                v_x1, v_y1, v_x2, v_y2 = map(int, box.xyxy[0])
                vw, vh = v_x2 - v_x1, v_y2 - v_y1

                if passes_vehicle_filter(label, confidence, vw, vh):
                    label_vn = VEHICLE_LABELS_VN.get(label, label)

                    # Two-stage: phát hiện biển số NGAY TRONG vùng xe (chính xác hơn)
                    plate_bbox, _ = detect_plate_in_region(img, [v_x1, v_y1, v_x2, v_y2])

                    plate_text = None
                    plate_crop_base64 = None
                    if plate_bbox:
                        p_x1, p_y1, p_x2, p_y2 = plate_bbox
                        # Cắt vùng biển số với một lề nhỏ
                        plate_crop = crop_with_margin(img, p_x1, p_y1, p_x2, p_y2)

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
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

# ==================== ENDPOINT: PHÂN TÍCH VIDEO ====================
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
        video_limit_seconds = 60  # chỉ xử lý 60s đầu của video

        # Cấu hình tracker để giảm phân mảnh track và bớt đếm xe vu vơ:
        #  - max_age=30: giữ track sống qua che khuất ngắn (~3s) -> ít gán ID mới.
        #  - n_init=3: cần thấy 3 frame liên tiếp mới xác nhận -> lọc detection nhất thời/giả.
        #  - max_cosine_distance=0.4: khớp ngoại hình "rộng tay" hơn -> ít tách 1 xe thành nhiều ID.
        tracker = DeepSort(max_age=30, n_init=3, nms_max_overlap=0.5, max_cosine_distance=0.4)
        # Bộ nhớ OCR theo track_id (chi tiết cấu trúc xem phần OCR voting bên dưới)
        track_plate_memory = {}

        # ---- Log thông tin video ----
        print("=" * 64)
        print(f"[VIDEO] File: {file.filename}")
        print(f"[VIDEO] FPS: {fps:.2f} | Tổng frame: {total_frames} | Thời lượng: {duration:.2f}s")
        print(f"[VIDEO] Lấy mẫu mỗi {sample_rate_seconds}s (~mỗi {frame_interval} frame) "
              f"| Giới hạn xử lý: {video_limit_seconds}s đầu | Thiết bị: {YOLO_DEVICE}")
        print("=" * 64)

        video_results = []
        frame_count = 0
        processed_frames = 0          # số frame thực sự đưa qua model
        seen_track_ids = set()        # tập track_id duy nhất -> số phương tiện theo dõi
        last_timestamp = 0.0          # mốc thời gian video đã xử lý tới
        start_time = time.time()      # đồng hồ đo thời gian xử lý thực tế

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            if frame_count % frame_interval == 0:
                timestamp = frame_count / fps
                last_timestamp = timestamp
                processed_frames += 1
                frame_start = time.time()
                
                # Nhận diện phương tiện bằng YOLO (imgsz cao + conf + NMS + device)
                v_results = vehicle_model(frame, imgsz=VEHICLE_IMGSZ, conf=VEHICLE_CONF,
                                          iou=NMS_IOU, device=YOLO_DEVICE, verbose=False)

                # Định dạng nhận diện cho DeepSORT: [ [left, top, width, height], conf, label ]
                ds_detections = []
                for res in v_results:
                    for box in res.boxes:
                        label = vehicle_model.names[int(box.cls[0])]
                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        vw, vh = x2 - x1, y2 - y1

                        if passes_vehicle_filter(label, conf, vw, vh):
                            ds_detections.append([[x1, y1, vw, vh], conf, label])

                # Cập nhật bộ theo dõi (Tracker)
                tracks = tracker.update_tracks(ds_detections, frame=frame)

                # Nhận diện biển số trên toàn khung hình (imgsz cao để bắt biển nhỏ)
                p_results = plate_model(frame, imgsz=PLATE_IMGSZ, conf=PLATE_CONF,
                                        device=YOLO_DEVICE, verbose=False)
                all_plates = []
                for res in p_results:
                    for box in res.boxes:
                        conf = float(box.conf[0])
                        if conf > PLATE_CONF:
                            all_plates.append({
                                "bbox": list(map(int, box.xyxy[0])),
                                "conf": conf
                            })
                
                # ---- Với mỗi xe đã được xác nhận: định vị biển + OCR voting + đóng gói ----
                frame_detections = []
                for track in tracks:
                    if not track.is_confirmed():
                        continue
                    # Bỏ qua track "ma" đang coasting (không có detection ở frame này):
                    # max_age cao giữ track sống để giữ track_id (chống đếm trùng),
                    # nhưng không vẽ box dự đoán -> tránh box trùng/lệch trên màn hình.
                    if track.time_since_update > 0:
                        continue

                    track_id = track.track_id
                    seen_track_ids.add(track_id)
                    # Lấy bbox theo định dạng [trái, trên, phải, dưới]
                    v_x1, v_y1, v_x2, v_y2 = map(int, track.to_ltrb())
                    
                    cls = track.get_det_class()
                    label_vn = VEHICLE_LABELS_VN.get(cls, cls)
                    
                    # Bộ nhớ OCR cho mỗi track: OCR chỉ chạy MỘT LẦN cho mỗi xe.
                    # {"text", "processed", "crop"}
                    mem = track_plate_memory.get(track_id, {"text": "[Không rõ]", "processed": False, "crop": None})
                    track_plate_memory[track_id] = mem

                    plate_text = mem["text"]
                    plate_crop_base64 = mem["crop"]

                    # Tìm plate_bbox mỗi frame để vẽ bounding box real-time
                    current_plate_bbox = get_best_plate_for_vehicle([v_x1, v_y1, v_x2, v_y2], all_plates)
                    plate_bbox_response = None
                    if current_plate_bbox:
                        pb_x1, pb_y1, pb_x2, pb_y2 = current_plate_bbox
                        plate_bbox_response = {"x": pb_x1, "y": pb_y1, "width": pb_x2 - pb_x1, "height": pb_y2 - pb_y1}

                    # OCR MỘT LẦN: chạy ở frame đầu tiên thấy biển đủ kích thước, rồi chốt.
                    if not mem["processed"] and current_plate_bbox:
                        p_x1, p_y1, p_x2, p_y2 = current_plate_bbox
                        if (p_x2 - p_x1) > MIN_PLATE_W and (p_y2 - p_y1) > MIN_PLATE_H:
                            plate_crop = crop_with_margin(frame, p_x1, p_y1, p_x2, p_y2)

                            if plate_crop.size > 0:
                                processed = preprocess_plate(plate_crop)
                                if processed is not None:
                                    _, buffer = cv2.imencode('.jpg', processed)
                                    mem["crop"] = base64.b64encode(buffer).decode('utf-8')
                                    plate_crop_base64 = mem["crop"]

                                    ocr_text, _ = read_license_plate(processed)
                                    if ocr_text:
                                        mem["text"] = ocr_text
                                        plate_text = ocr_text
                                    mem["processed"] = True   # OCR chỉ một lần

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

                # ---- Log tiến độ mỗi frame được xử lý ----
                elapsed = time.time() - start_time
                frame_ms = (time.time() - frame_start) * 1000
                proc_fps = processed_frames / elapsed if elapsed > 0 else 0
                print(f"[TRACK] frame {frame_count}/{total_frames} | video t={timestamp:5.1f}s "
                      f"| xe đang hiện: {len(frame_detections):2d} | biển: {len(all_plates):2d} "
                      f"| track tích lũy: {len(seen_track_ids):3d} "
                      f"| {frame_ms:5.0f}ms/frame | đã chạy {elapsed:5.1f}s ({proc_fps:.1f} fps)")

            frame_count += 1
            if frame_count / fps > video_limit_seconds:
                print(f"[VIDEO] Đã đạt giới hạn {video_limit_seconds}s, dừng xử lý.")
                break

        cap.release()

        # ---- Log tổng kết ----
        total_elapsed = time.time() - start_time
        proc_video_seconds = last_timestamp
        avg_fps = processed_frames / total_elapsed if total_elapsed > 0 else 0
        realtime_factor = proc_video_seconds / total_elapsed if total_elapsed > 0 else 0
        print("=" * 64)
        print(f"[XONG] Đã đọc {frame_count} frame, xử lý {processed_frames} frame")
        print(f"[XONG] Phương tiện theo dõi (track_id duy nhất): {len(seen_track_ids)}")
        print(f"[XONG] Đoạn video đã xử lý: {proc_video_seconds:.2f}s / {duration:.2f}s")
        print(f"[XONG] Thời gian xử lý thực tế: {total_elapsed:.2f}s "
              f"| TB {avg_fps:.1f} fps | tốc độ {realtime_factor:.2f}x so với realtime")
        print("=" * 64)

        return {"status": "success", "duration": duration, "results": video_results}

    except Exception as e:
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
