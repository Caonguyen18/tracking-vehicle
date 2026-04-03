export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  track_id: number;
  type: 'vehicle' | 'plate';
  bbox: BoundingBox;
  confidence: number;
  plate_text?: string;
  plate_bbox?: BoundingBox;
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
  camera_id: string;
  timestamp: number;
  confidence: number;
  image_url?: string;
}
