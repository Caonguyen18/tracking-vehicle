# Vehicle License Plate Detection & Tracking System Architecture

This document outlines the system architecture for a real-time vehicle license plate detection and tracking system using YOLO, DeepSORT, and OCR.

## 1. System Architecture

The system is designed with a microservices-inspired architecture to decouple heavy AI inference from the backend web server, allowing for independent scaling and failure isolation.

*   **AI Inference Service (Python/PyTorch):** Dedicated to processing video streams, running AI models (YOLO, DeepSORT, OCR), and outputting metadata.
*   **Backend API Service (Python/FastAPI):** Acts as the central hub. It ingests metadata from the AI service, stores it in the database, serves REST APIs, and manages WebSocket connections to the frontend.
*   **Message Broker (Redis/ZeroMQ):** Facilitates high-throughput, low-latency communication between the AI Service and the Backend.
*   **Database (PostgreSQL):** Relational database to store cameras, detection events, timestamps, and recognized plates. PostgreSQL is preferred for its robust querying (e.g., search by plate, filtering by time).
*   **Frontend (React/Vite):** The user-facing dashboard for viewing live streams, bounding boxes, and historical data.

## 2. Folder Structure

A monorepo structure is recommended for ease of development, though components can act as separate services.

```text
license-plate-tracker/
├── ai_service/                 # Core AI Inference Service
│   ├── models/                 # Stored weights (YOLO .pt, DeepSORT, OCR models)
│   ├── modules/
│   │   ├── detector.py         # YOLO initialization & inference
│   │   ├── tracker.py          # DeepSORT integration
│   │   └── recognizer.py       # OCR pipeline (e.g., EasyOCR or LPRNet)
│   ├── stream_reader.py        # RTSP/Webcam capture threads
│   ├── pipeline.py             # Main processing loop connecting AI components
│   ├── publisher.py            # Redis/ZeroMQ publisher for results
│   └── requirements.txt        
├── backend/                    # FastAPI Server
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/         # REST API endpoints (cameras, history)
│   │   │   └── websockets.py   # WebSocket connection managers
│   │   ├── core/               # App config, DB credentials
│   │   ├── db/                 # SQLAlchemy models & migrations (Alembic)
│   │   ├── services/           # DB CRUD and Message Broker consumers
│   │   └── main.py             # FastAPI entry point
│   └── pyproject.toml
├── frontend/                   # React App
│   ├── src/
│   │   ├── components/         # Reusable UI (VideoPlayer, BoundingBoxOverlay, DataTable)
│   │   ├── pages/              # Dashboard, LiveCamera, Analytics
│   │   ├── services/           # API hooks (Axios/React Query) & WS clients
│   │   └── store/              # State management for realtime events
│   ├── package.json
│   └── tailwind.config.js
├── docker-compose.yml          # Local orchestration
└── .env.example
```

## 3. Data Flow

1.  **Ingestion:** The **AI Service** connects to the RTSP stream using OpenCV or FFmpeg hardware decoding. Frames are placed into a thread-safe queue.
2.  **Inference (AI Pipeline):**
    *   **Detection:** YOLO takes a frame and outputs bounding boxes for `[vehicle, license_plate]`.
    *   **Tracking:** DeepSORT assigns unique IDs (e.g., track_id `15`) to vehicles across consecutive frames.
    *   **Recognition:** When a license plate is detected with high confidence, the AI crops the region and passes it to the OCR model. *(Optimization: OCR is only run once every N frames per tracked vehicle, or when the plate box is largest/clearest).*
3.  **Broker Pub/Sub:** The AI Service publishes a structured JSON payload to the **Message Broker** (e.g., a Redis pub/sub channel called `live_detections`). It may also stream low-FPS JPEG encoded frames for the frontend.
4.  **Backend Processing:**
    *   The **Backend** consumes messages from the broker.
    *   It asynchronously writes unique/significant plate reads to **PostgreSQL**.
    *   It broadcasts the live detection payload to all active **WebSocket clients**.
5.  **Frontend Rendering:** The **React Frontend** receives the WebSocket messages and updates the live video overlay (drawing bounding boxes and text) and appends the plate to the "Recent Detections" side-panel.

## 4. API Design

### REST API (FastAPI)

*   `GET /api/v1/cameras` - Retrieve available camera streams.
*   `GET /api/v1/detections` - Retrieve historical detection logs.
    *   *Query params: `camera_id`, `start_time`, `end_time`, `limit`, `offset`*
*   `GET /api/v1/detections/search?plate={plate_number}` - Search for a specific license plate (exact or partial match).
*   `GET /api/v1/stats` - Get system statistics (total plates read today, active cameras).

### WebSocket API

*   `ws://{backend_host}/ws/stream/{camera_id}`
    *   **Server sends:** Real-time metadata for drawing overlays.
    *   *Payload example:*
        ```json
        {
          "timestamp": 1718301234.567,
          "frame_id": 4021,
          "objects": [
            {
              "track_id": 12,
              "type": "vehicle",
              "bbox": [100, 200, 300, 400],
              "plate_text": "ABC-1234",
              "plate_bbox": [200, 350, 250, 380]
            }
          ]
        }
        ```

## 5. Real-Time Processing Pipeline Guidelines

To achieve real-time performance (20-30 FPS), strict optimizations are necessary:

*   **Multithreading/Multiprocessing:** Separate reading frames (I/O bound) from running YOLO/DeepSORT (GPU/CPU bound).
*   **Batching:** If analyzing multiple cameras on one GPU, batch frames together for a single YOLO inference call.
*   **OCR Throttling:** OCR is extremely slow compared to YOLO. Do not run OCR on every frame for every vehicle. Instead:
    *   Track the vehicle with DeepSORT.
    *   Keep highly confident plate crops in memory.
    *   Run OCR only when the bounding box area is maximized (i.e., vehicle is closest).
*   **TensorRT Optimization:** Convert your PyTorch YOLO model to TensorRT (`.engine` format) for maximum throughput on NVIDIA GPUs.

## 6. Deployment Considerations

*   **GPU Acceleration:** The AI Service must be deployed on a machine with a CUDA-enabled NVIDIA GPU. Docker must be configured with the NVIDIA Container Toolkit (`runtime: nvidia`).
*   **Containerization:** Use Docker Compose to spin up Redis, PostgreSQL, FastAPI, and the React frontend simultaneously. 
*   **Video Serving:** If pushing raw video through WebSockets is too intensive, consider using an external streaming server like MediaMTX (formerly rtsp-simple-server) to serve raw WebRTC/HLS to the frontend, while the backend solely serves the bounding-box metadata via WebSockets. The frontend then syncs the metadata with the HTML video player.
*   **Data Retention:** Plate detection logs can grow massively. Implement a database cleanup cron job or partitioned tables in PostgreSQL to archive/delete records older than 30 or 60 days.
