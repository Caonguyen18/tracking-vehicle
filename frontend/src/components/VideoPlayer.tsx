import React, { useRef, useEffect, useState } from 'react';
import { Camera, Activity, Play, Pause, Gauge, RotateCcw, RotateCw } from 'lucide-react';
import type { StreamFrame, VideoAnalysisResult, FrameResults, Detection, BoundingBox } from '../types';
import type { MediaSource } from './SourceSelector';
import { formatVehicleLabel, hasValidPlate } from '../utils/plate';

interface VideoPlayerProps {
  streamData: StreamFrame | null;
  status: 'connecting' | 'live' | 'offline';
  source: MediaSource | null;
  videoAnalysis?: VideoAnalysisResult | null;
  seekTo?: number;
}

// Toạ độ một hình chữ nhật trong hệ canvas (1920x1080)
type CanvasRect = { x: number; y: number; w: number; h: number };

// ===== Tiện ích vẽ overlay (dùng chung cho cả video và ảnh tĩnh) =====

/** Vẽ 4 góc kiểu "ngoặc vuông" cho một hình chữ nhật. */
const drawCornerBrackets = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, size: number
) => {
  ctx.beginPath(); ctx.moveTo(x, y + size); ctx.lineTo(x, y); ctx.lineTo(x + size, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - size, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + size); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w, y + h - size); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - size, y + h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + size, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - size); ctx.stroke();
};

/**
 * Tạo hàm ánh xạ bbox (theo pixel ảnh gốc) sang toạ độ canvas 1920x1080.
 * Media hiển thị dạng object-contain nên có lề căn giữa (hai bên hoặc trên/dưới);
 * hàm này quy đổi: pixel gốc -> vùng hiển thị thực + lề -> hệ canvas nội tại.
 */
const makeBboxMapper = (
  canvas: HTMLCanvasElement,
  natural: { width: number; height: number }
): ((b: BoundingBox) => CanvasRect) => {
  const containerWidth = canvas.clientWidth;
  const containerHeight = canvas.clientHeight;
  const mediaRatio = natural.width / natural.height;
  const containerRatio = containerWidth / containerHeight;

  // Kích thước media thực tế sau object-contain + lề căn giữa
  let displayWidth, displayHeight, offsetX = 0, offsetY = 0;
  if (containerRatio > mediaRatio) {
    displayHeight = containerHeight;
    displayWidth = containerHeight * mediaRatio;
    offsetX = (containerWidth - displayWidth) / 2;
  } else {
    displayWidth = containerWidth;
    displayHeight = containerWidth / mediaRatio;
    offsetY = (containerHeight - displayHeight) / 2;
  }

  // Canvas có kích thước nội tại 1920x1080 nhưng CSS phủ full khung -> cần quy đổi
  const canvasScaleX = 1920 / containerWidth;
  const canvasScaleY = 1080 / containerHeight;

  return (b: BoundingBox) => ({
    x: ((b.x / natural.width) * displayWidth + offsetX) * canvasScaleX,
    y: ((b.y / natural.height) * displayHeight + offsetY) * canvasScaleY,
    w: (b.width / natural.width) * displayWidth * canvasScaleX,
    h: (b.height / natural.height) * displayHeight * canvasScaleY,
  });
};

/** Vẽ một phương tiện: hộp bao xe + nhãn, kèm hộp bao biển số (xanh lá) nếu có. */
const drawDetection = (
  ctx: CanvasRenderingContext2D,
  obj: Detection,
  map: (b: BoundingBox) => CanvasRect
) => {
  const { x, y, w, h } = map(obj.bbox);
  const color = '#3B82F6';

  // Hộp bao xe (góc ngoặc xanh dương)
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 0;
  drawCornerBrackets(ctx, x, y, w, h, Math.min(20, w * 0.2, h * 0.2));

  // Nhãn: có biển số -> nền xanh lá; không có -> chỉ hiện loại xe
  const labelText = formatVehicleLabel(obj.track_id, obj.type, obj.plate_text);
  ctx.font = 'bold 16px "Inter", sans-serif';
  ctx.fillStyle = hasValidPlate(obj.plate_text) ? '#10B981' : color;
  ctx.beginPath();
  ctx.rect(x, y - 32, ctx.measureText(labelText).width + 16, 28);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, x + 8, y - 18);

  // Hộp bao biển số (nếu phát hiện được)
  if (obj.plate_bbox) {
    const p = map(obj.plate_bbox);
    const plateColor = '#10B981';
    ctx.lineWidth = 2;
    ctx.strokeStyle = plateColor;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 8;
    ctx.shadowColor = plateColor;
    drawCornerBrackets(ctx, p.x, p.y, p.w, p.h, Math.min(12, p.w * 0.25, p.h * 0.25));
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ streamData, status, source, videoAnalysis, seekTo }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement>(null);
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 1920, height: 1080 });
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Nhảy tới mốc thời gian khi người dùng bấm vào một bản ghi lịch sử
  useEffect(() => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement && seekTo !== undefined && seekTo !== null) {
      video.currentTime = seekTo;
      setCurrentTime(seekTo);
      // Tự phát nếu đang tạm dừng
      if (video.paused) {
        video.play();
        setIsPlaying(true);
      }
    }
  }, [seekTo]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTimeUpdate = () => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement) {
      setCurrentTime(video.currentTime);
    }
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent) => {
    handleMediaLoad(e);
    const video = e.target as HTMLVideoElement;
    if (video instanceof HTMLVideoElement) {
      setDuration(video.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement) {
      const time = parseFloat(e.target.value);
      video.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleSkip = (seconds: number) => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement) {
      video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), duration);
    }
  };

  // Lưu kích thước gốc của media để ánh xạ toạ độ bbox chính xác
  const handleMediaLoad = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLVideoElement) {
      setNaturalDimensions({ width: target.videoWidth, height: target.videoHeight });
    } else if (target instanceof HTMLImageElement) {
      setNaturalDimensions({ width: target.naturalWidth, height: target.naturalHeight });
    }
  };

  const togglePlayback = () => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement) {
      if (isPlaying) {
        video.pause();
      } else {
        video.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const changeSpeed = (speed: number) => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement) {
      video.playbackRate = speed;
      setPlaybackRate(speed);
    }
  };

  // Vẽ overlay đồng bộ theo thời điểm phát của video phân tích
  useEffect(() => {
    const video = mediaRef.current;
    const canvas = canvasRef.current;
    if (!video || !(video instanceof HTMLVideoElement) || !canvas || !videoAnalysis) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawFrame = () => {
      // Lấy kết quả phân tích gần nhất tính tới thời điểm hiện tại của video
      const closestResults = videoAnalysis.results.reduce((prev: FrameResults | null, curr: FrameResults) => {
        if (curr.timestamp <= video.currentTime) {
          return (!prev || curr.timestamp > prev.timestamp) ? curr : prev;
        }
        return prev;
      }, null);

      if (closestResults && naturalDimensions.width > 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const map = makeBboxMapper(canvas, naturalDimensions);
        closestResults.detections.forEach((obj: Detection) => drawDetection(ctx, obj, map));
      } else if (!closestResults) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    video.addEventListener('timeupdate', drawFrame);
    video.addEventListener('seeked', drawFrame);

    // Vòng lặp requestAnimationFrame giúp overlay mượt khi đang phát
    let animationId: number;
    const loop = () => {
      if (!video.paused) drawFrame();
      animationId = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      video.removeEventListener('timeupdate', drawFrame);
      video.removeEventListener('seeked', drawFrame);
      cancelAnimationFrame(animationId);
    };
  }, [videoAnalysis, naturalDimensions]);

  // Vẽ overlay cho ảnh tĩnh (một khung hình duy nhất)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !streamData || naturalDimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const map = makeBboxMapper(canvas, naturalDimensions);
    streamData.objects.forEach((obj) => drawDetection(ctx, obj, map));
  }, [streamData, naturalDimensions]);

  const renderMedia = () => {
    if (!source) {
      // Ảnh nền mặc định khi chưa chọn nguồn
      return (
        <img
          src="https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=1920&auto=format&fit=crop"
          alt="Highway Feed Placeholder"
          className="w-full h-full object-contain opacity-30"
        />
      );
    }

    if (source.type === 'video') {
      return (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={source.url}
          autoPlay
          loop
          muted
          controls={false}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          className="w-full h-full object-contain opacity-90"
        />
      );
    }

    if (source.type === 'image') {
      return (
        <img
          ref={mediaRef as React.RefObject<HTMLImageElement>}
          src={source.url}
          alt="Uploaded Source"
          onLoad={handleMediaLoad}
          className="w-full h-full object-contain opacity-90"
        />
      );
    }

    if (source.type === 'stream') {
      // Stream nhúng (rtsp.me / youtube) -> hiển thị qua iframe
      if (source.url.includes('rtsp.me/embed/') || source.url.includes('youtube.com/embed/')) {
        return (
          <iframe
            src={source.url}
            className="w-full h-full object-contain border-0 z-0 bg-black"
            allowFullScreen
            allow="autoplay; encrypted-media"
          />
        );
      }

      // Stream trực tiếp (RTSP/WebSocket) -> trạng thái đang kết nối
      return (
        <div className="w-full h-full bg-dark-900 border border-dark-700 flex items-center justify-center flex-col">
          <Activity className="w-12 h-12 text-primary-500 animate-spin mb-4" />
          <p className="text-slate-400">Đang kết nối: {source.url}</p>
        </div>
      );
    }
  };

  return (
    <div className="relative bg-black rounded-3xl overflow-hidden border border-white/5 shadow-2xl flex flex-col group/player">
      {/* Video Content */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center">
        {status === 'live' || status === 'connecting' ? (
          <>
            {renderMedia()}

            {/* Overlay Canvas for Bounding Boxes */}
            {(source?.type !== 'stream' || status === 'live') && (
              <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                className="absolute top-0 left-0 w-full h-full pointer-events-none object-contain"
              />
            )}

            {/* Custom Minimalist Controls */}
            {source?.type === 'video' && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl opacity-0 group-hover/player:opacity-100 transition-all duration-300 transform translate-y-2 group-hover/player:translate-y-0 z-30">
                 <button
                  onClick={togglePlayback}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                </button>

                <div className="flex items-center gap-1 group/skip">
                  <button onClick={() => handleSkip(-10)} className="p-1 hover:text-white text-slate-400 transition-colors">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleSkip(10)} className="p-1 hover:text-white text-slate-400 transition-colors">
                    <RotateCw className="w-4 h-4" />
                  </button>
                </div>

                <div className="w-px h-4 bg-white/10 mx-1"></div>

                <div className="flex items-center gap-3 px-2 min-w-[200px]">
                  <span className="text-[10px] font-mono text-slate-400 w-10">{formatTime(currentTime)}</span>
                  <div className="relative flex-1 group/seek">
                    <input
                      type="range"
                      min={0}
                      max={duration}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-primary-500 hover:h-2 transition-all"
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 w-10">{formatTime(duration)}</span>
                </div>

                <div className="w-px h-4 bg-white/10 mx-1"></div>

                <div className="flex items-center gap-1">
                  <Gauge className="w-4 h-4 text-slate-400 mr-2" />
                  {[0.5, 1, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => changeSpeed(speed)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                        playbackRate === speed
                          ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            )}

          </>
        ) : (
          <div className="text-center flex flex-col items-center">
            <Camera className="w-16 h-16 text-dark-700 mb-4" />
            <p className="text-slate-500 font-medium">Nguồn cấp chưa khả dụng</p>
          </div>
        )}
      </div>
    </div>
  );
};
