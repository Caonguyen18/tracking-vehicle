import React, { useRef, useEffect, useState } from 'react';
import { Camera, Activity, Play, Pause, Gauge, RotateCcw, RotateCw } from 'lucide-react';
import type { StreamFrame, VideoAnalysisResult, FrameResults, Detection } from '../types';
import type { MediaSource } from './SourceSelector';

interface VideoPlayerProps {
  streamData: StreamFrame | null;
  status: 'connecting' | 'live' | 'offline';
  source: MediaSource | null;
  videoAnalysis?: VideoAnalysisResult | null;
  seekTo?: number;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ streamData, status, source, videoAnalysis, seekTo }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement>(null);
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 1920, height: 1080 });
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Handle external seek requests
  useEffect(() => {
    const video = mediaRef.current;
    if (video instanceof HTMLVideoElement && seekTo !== undefined && seekTo !== null) {
      video.currentTime = seekTo;
      setCurrentTime(seekTo);
      // Auto-play when jumping if paused
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !streamData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear previous frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale ratio based on actual canvas size vs natural dimensions
    const scaleX = canvas.width / naturalDimensions.width;
    const scaleY = canvas.height / naturalDimensions.height;

    streamData.objects.forEach(obj => {
      // Scale bounding box coordinates
      const x = obj.bbox.x * scaleX;
      const y = obj.bbox.y * scaleY;
      const w = obj.bbox.width * scaleX;
      const h = obj.bbox.height * scaleY;

      const isPlate = obj.type === 'plate';
      const color = isPlate ? '#10B981' : '#3B82F6';
      const secondaryColor = isPlate ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.4)';

      // --- Draw Futuristic Corner Brackets ---
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Add a subtle glow
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;

      const cornerSize = Math.min(20, w * 0.2, h * 0.2);

      // Top-left
      ctx.beginPath();
      ctx.moveTo(x, y + cornerSize);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cornerSize, y);
      ctx.stroke();

      // Top-right
      ctx.beginPath();
      ctx.moveTo(x + w - cornerSize, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cornerSize);
      ctx.stroke();

      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(x + w, y + h - cornerSize);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w - cornerSize, y + h);
      ctx.stroke();

      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(x + cornerSize, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + h - cornerSize);
      ctx.stroke();

      // Optional: Very light semi-transparent background for the whole box
      ctx.shadowBlur = 0; // Reset shadow for background
      ctx.fillStyle = secondaryColor.replace('0.4', '0.05');
      ctx.fillRect(x, y, w, h);

      // --- Draw Stylized Label ---
      const labelText = `${obj.type} - ${obj.plate_text || '[Không rõ]'}`;
      ctx.font = 'bold 13px "Inter", "Segoe UI", sans-serif';
      const textWidth = ctx.measureText(labelText).width;
      const labelPadding = 8;
      const labelHeight = 24;
      
      ctx.fillStyle = obj.plate_text && obj.plate_text !== "[Không rõ]" ? '#10B981' : color;
      ctx.beginPath();
      ctx.rect(x, y - labelHeight - 4, textWidth + labelPadding * 2, labelHeight);
      ctx.fill();

      // Label Text
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, x + labelPadding, y - labelHeight / 2 - 4);

      // Confidence Tag (Small pill on the right)
      const confText = `${Math.round(obj.confidence * 100)}%`;
      ctx.font = '9px "Inter", sans-serif';
      const confWidth = ctx.measureText(confText).width;
      
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(x + textWidth + labelPadding * 2 + 4, y - labelHeight - 4, confWidth + 8, labelHeight);
      ctx.fill();
      
      ctx.fillStyle = color;
      ctx.fillText(confText, x + textWidth + labelPadding * 2 + 8, y - labelHeight / 2 - 4);
    });
  }, [streamData, naturalDimensions]);

  // Synchronization logic for Video Analysis
  useEffect(() => {
    const video = mediaRef.current;
    const canvas = canvasRef.current;
    if (!video || !(video instanceof HTMLVideoElement) || !canvas || !videoAnalysis) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawFrame = () => {
      const currentTime = video.currentTime;
      
      // Find the closest result up to the current time
      const closestResults = videoAnalysis.results.reduce((prev: FrameResults | null, curr: FrameResults) => {
        if (curr.timestamp <= currentTime) {
          return (!prev || curr.timestamp > prev.timestamp) ? curr : prev;
        }
        return prev;
      }, null);

      if (closestResults && naturalDimensions.width > 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Calculate object-contain dimensions
        const containerWidth = canvas.clientWidth;
        const containerHeight = canvas.clientHeight;
        const mediaRatio = naturalDimensions.width / naturalDimensions.height;
        const containerRatio = containerWidth / containerHeight;

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

        // Mapping function: original -> display -> canvas(1920x1080)
        // Since canvas itself is CSS w-full h-full, we work in canvas coordinate space 1920x1080
        const canvasScaleX = 1920 / containerWidth;
        const canvasScaleY = 1080 / containerHeight;

        closestResults.detections.forEach((obj: Detection) => {
          // Normalize to [0,1] then to display pixels, then add offset, then to 1920x1080
          const x = ((obj.bbox.x / naturalDimensions.width) * displayWidth + offsetX) * canvasScaleX;
          const y = ((obj.bbox.y / naturalDimensions.height) * displayHeight + offsetY) * canvasScaleY;
          const w = (obj.bbox.width / naturalDimensions.width) * displayWidth * canvasScaleX;
          const h = (obj.bbox.height / naturalDimensions.height) * displayHeight * canvasScaleY;

          const color = '#3B82F6';
          ctx.lineWidth = 3;
          ctx.strokeStyle = color;
          
          // Draw Corners
          const cornerSize = Math.min(20, w * 0.2, h * 0.2);
          ctx.beginPath(); ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + w, y + h - cornerSize); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerSize, y + h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + cornerSize, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cornerSize); ctx.stroke();

          // Label
          const labelText = `${obj.type} - ${obj.plate_text || '[Không rõ]'}`;
          ctx.font = 'bold 16px "Inter", sans-serif';
          const textWidth = ctx.measureText(labelText).width;
          
          ctx.fillStyle = obj.plate_text && obj.plate_text !== "[Không rõ]" ? '#10B981' : color;
          ctx.beginPath();
          ctx.rect(x, y - 32, textWidth + 16, 28);
          ctx.fill();
          
          ctx.fillStyle = '#FFFFFF';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, x + 8, y - 18);

          // Draw Plate Bounding Box (green corner brackets)
          if (obj.plate_bbox) {
            const px = ((obj.plate_bbox.x / naturalDimensions.width) * displayWidth + offsetX) * canvasScaleX;
            const py = ((obj.plate_bbox.y / naturalDimensions.height) * displayHeight + offsetY) * canvasScaleY;
            const pw = (obj.plate_bbox.width / naturalDimensions.width) * displayWidth * canvasScaleX;
            const ph = (obj.plate_bbox.height / naturalDimensions.height) * displayHeight * canvasScaleY;

            const plateColor = '#10B981';
            ctx.lineWidth = 2;
            ctx.strokeStyle = plateColor;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 8;
            ctx.shadowColor = plateColor;

            const pCorner = Math.min(12, pw * 0.25, ph * 0.25);
            ctx.beginPath(); ctx.moveTo(px, py + pCorner); ctx.lineTo(px, py); ctx.lineTo(px + pCorner, py); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px + pw - pCorner, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw, py + pCorner); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px + pw, py + ph - pCorner); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px + pw - pCorner, py + ph); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px + pCorner, py + ph); ctx.lineTo(px, py + ph); ctx.lineTo(px, py + ph - pCorner); ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
            ctx.fillRect(px, py, pw, ph);
          }
        });
      } else if (!closestResults) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    video.addEventListener('timeupdate', drawFrame);
    video.addEventListener('seeked', drawFrame);
    
    // Add animation frame loop for smoother sync during playback
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

  // Handle single frame image detection (same logic)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !streamData || naturalDimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const containerWidth = canvas.clientWidth;
    const containerHeight = canvas.clientHeight;
    const mediaRatio = naturalDimensions.width / naturalDimensions.height;
    const containerRatio = containerWidth / containerHeight;

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

    const canvasScaleX = 1920 / containerWidth;
    const canvasScaleY = 1080 / containerHeight;

    streamData.objects.forEach((obj) => {
      const x = ((obj.bbox.x / naturalDimensions.width) * displayWidth + offsetX) * canvasScaleX;
      const y = ((obj.bbox.y / naturalDimensions.height) * displayHeight + offsetY) * canvasScaleY;
      const w = (obj.bbox.width / naturalDimensions.width) * displayWidth * canvasScaleX;
      const h = (obj.bbox.height / naturalDimensions.height) * displayHeight * canvasScaleY;

      const color = '#3B82F6';
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      
      // Draw Corners
      const cornerSize = Math.min(20, w * 0.2, h * 0.2);
      ctx.beginPath(); ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w, y + h - cornerSize); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerSize, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + cornerSize, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cornerSize); ctx.stroke();

      const labelText = `${obj.type} - ${obj.plate_text || '[Không rõ]'}`;
      ctx.font = 'bold 16px "Inter", sans-serif';
      ctx.fillStyle = obj.plate_text && obj.plate_text !== "[Không rõ]" ? '#10B981' : color;
      ctx.beginPath();
      ctx.rect(x, y - 32, ctx.measureText(labelText).width + 16, 28);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(labelText, x + 8, y - 18);

      // Draw Plate Bounding Box (green corner brackets)
      if (obj.plate_bbox) {
        const px = ((obj.plate_bbox.x / naturalDimensions.width) * displayWidth + offsetX) * canvasScaleX;
        const py = ((obj.plate_bbox.y / naturalDimensions.height) * displayHeight + offsetY) * canvasScaleY;
        const pw = (obj.plate_bbox.width / naturalDimensions.width) * displayWidth * canvasScaleX;
        const ph = (obj.plate_bbox.height / naturalDimensions.height) * displayHeight * canvasScaleY;

        const plateColor = '#10B981';
        ctx.lineWidth = 2;
        ctx.strokeStyle = plateColor;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 8;
        ctx.shadowColor = plateColor;

        const pCorner = Math.min(12, pw * 0.25, ph * 0.25);
        ctx.beginPath(); ctx.moveTo(px, py + pCorner); ctx.lineTo(px, py); ctx.lineTo(px + pCorner, py); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + pw - pCorner, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw, py + pCorner); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + pw, py + ph - pCorner); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px + pw - pCorner, py + ph); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + pCorner, py + ph); ctx.lineTo(px, py + ph); ctx.lineTo(px, py + ph - pCorner); ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
        ctx.fillRect(px, py, pw, ph);
      }
    });
  }, [streamData, naturalDimensions]);

  const renderMedia = () => {
    if (!source) {
      // Default placeholder if no source is selected
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
      // Check if it's a known embedded stream service (like rtsp.me or youtube)
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
      
      // Simulate direct RTSP/WebSocket connecting
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
