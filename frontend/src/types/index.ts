export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  track_id: number;
  type: string;
  bbox: BoundingBox;
  confidence: number;
  plate_text?: string;
  plate_bbox?: BoundingBox;
  plate_crop?: string;
}

export interface StreamFrame {
  camera_id: string;
  timestamp: number;
  frame_id: number;
  objects: Detection[];
}

export interface PlateRecord {
  id: string;
  plate_text: string;
  vehicle_type: string;
  camera_id: string;
  timestamp: number;
  confidence: number;
  image_url?: string;
  plate_crop?: string;
  video_start_time?: number;
  video_duration?: number;
  // Vị trí xe ở frame đầu/cuối của track (chỉ có ở video) — dùng để ghép
  // lại các track của cùng một xe khi DeepSort mất dấu rồi bắt lại.
  first_bbox?: BoundingBox;
  last_bbox?: BoundingBox;
  // Số frame (đã lấy mẫu) mà track xuất hiện — dùng để lọc track thoáng qua/giả.
  frames_seen?: number;
}

export interface FrameResults {
  timestamp: number;
  detections: Detection[];
}

export interface VideoAnalysisResult {
  duration: number;
  results: FrameResults[];
}
