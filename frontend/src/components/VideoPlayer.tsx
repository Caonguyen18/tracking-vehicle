import React, { useRef, useEffect } from 'react';
import { Camera, Activity } from 'lucide-react';
import type { StreamFrame } from '../types';
import type { MediaSource } from './SourceSelector';

interface VideoPlayerProps {
  name: string;
  streamData: StreamFrame | null;
  status: 'connecting' | 'live' | 'offline';
  source: MediaSource | null;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ name, streamData, status, source }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement>(null);
  const [naturalDimensions, setNaturalDimensions] = React.useState({ width: 1920, height: 1080 });
  
  const handleMediaLoad = (e: React.SyntheticEvent) => {
    const target = e.target as any;
    if (target.tagName === 'VIDEO') {
      setNaturalDimensions({ width: target.videoWidth, height: target.videoHeight });
    } else if (target.tagName === 'IMG') {
      setNaturalDimensions({ width: target.naturalWidth, height: target.naturalHeight });
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

      // Draw vehicle box
      ctx.lineWidth = 2;
      const isPlate = obj.type === 'plate';
      ctx.strokeStyle = isPlate ? '#10B981' : '#3B82F6';
      ctx.strokeRect(x, y, w, h);

      // Draw label background
      ctx.fillStyle = isPlate ? 'rgba(16, 185, 129, 0.8)' : 'rgba(59, 130, 246, 0.8)';
      ctx.fillRect(x, y - 24, w > 120 ? w : 120, 24);

      // Draw text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px "Inter", sans-serif';
      
      let label = obj.type;
      if (obj.plate_text) label += ` [${obj.plate_text}]`;
      
      ctx.fillText(label, x + 4, y - 8);
    });
  }, [streamData]);

  const renderMedia = () => {
    if (!source) {
      // Default placeholder if no source is selected
      return (
        <img 
          src="https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=1920&auto=format&fit=crop" 
          alt="Highway Feed Placeholder" 
          className="w-full h-full object-cover opacity-30"
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
          onLoadedMetadata={handleMediaLoad}
          className="w-full h-full object-cover opacity-90"
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
          className="w-full h-full object-cover opacity-90"
        />
      );
    }

    if (source.type === 'stream') {
      // Check if it's a known embedded stream service (like rtsp.me or youtube)
      if (source.url.includes('rtsp.me/embed/') || source.url.includes('youtube.com/embed/')) {
        return (
          <iframe 
            src={source.url} 
            className="w-full h-full object-cover border-0 z-0 bg-black"
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
    <div className="relative bg-dark-900 rounded-xl overflow-hidden border border-dark-700 shadow-2xl flex flex-col">
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center space-x-3">
          <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center shadow-lg">
            <Camera className="w-4 h-4 text-slate-300 mr-2" />
            <span className="text-sm font-semibold text-white tracking-wide max-w-[200px] truncate" title={name}>{name}</span>
          </div>
          <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center shadow-lg">
            {status === 'live' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
                <span className="text-xs font-bold text-red-500 tracking-wider">TRỰC TIẾP</span>
              </>
            ) : status === 'connecting' ? (
              <>
                <Activity className="w-3.5 h-3.5 text-yellow-500 mr-2 animate-spin" />
                <span className="text-xs font-bold text-yellow-500 tracking-wider">ĐANG KẾT NỐI...</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-slate-500 mr-2"></span>
                <span className="text-xs font-bold text-slate-400 tracking-wider">NGOẠI TUYẾN</span>
              </>
            )}
          </div>
        </div>
        
        {/* <button className="p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-lg border border-white/10 text-white transition-all transform hover:scale-105">
          <Maximize2 className="w-4 h-4" />
        </button> */}
      </div>

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
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />
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
