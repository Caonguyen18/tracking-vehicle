import React, { useState, useEffect } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { DetectionHistory } from './components/DetectionHistory';
import { SourceSelector, type MediaSource } from './components/SourceSelector';
import type { PlateRecord, StreamFrame } from './types';
import { Search, ShieldAlert } from 'lucide-react';

// Random plate generator for mock data
const generatePlate = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  const rC = () => chars[Math.floor(Math.random() * chars.length)];
  const rN = () => nums[Math.floor(Math.random() * nums.length)];
  return `${rN()}${rC()}-${rN()}${rN()}${rN()}${rN()}`;
};

export default function App() {
  const [streamData, setStreamData] = useState<StreamFrame | null>(null);
  const [history, setHistory] = useState<PlateRecord[]>([]);
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);

  // Mock WebSocket Connection
  useEffect(() => {
    let frameCount = 0;
    
    const interval = setInterval(() => {
      frameCount++;
      
      // 1. Simulate video frame metadata (bounding boxes moving)
      // Base positions that slowly shift
      const baseX = 800 + Math.sin(frameCount * 0.05) * 400;
      const baseY = 400 + Math.cos(frameCount * 0.05) * 100;
      
      const frame: StreamFrame = {
        camera_id: 'CAM-01',
        timestamp: Date.now() / 1000,
        frame_id: frameCount,
        objects: [
          {
            id: `v_${frameCount}`,
            track_id: 1042,
            type: 'vehicle',
            bbox: { x: baseX, y: baseY, width: 450, height: 350 },
            confidence: 0.95
          }
        ]
      };

      // Occasionally add a license plate detection (1 in 30 frames simulate highly confident read)
      if (frameCount % 45 === 0) {
        const newPlateText = generatePlate();
        
        // Add plate to current frame objects
        frame.objects.push({
          id: `p_${frameCount}`,
          track_id: 1042, // Associated with vehicle
          type: 'plate',
          bbox: { x: baseX + 150, y: baseY + 250, width: 120, height: 40 },
          confidence: 0.98 + (Math.random() * 0.01),
          plate_text: newPlateText
        });
        
        // Add to history
        const newRecord: PlateRecord = {
          id: `rec_${Date.now()}`,
          plate_text: newPlateText,
          camera_id: 'CAM-01',
          timestamp: Date.now() / 1000,
          confidence: 0.98
        };
        
        setHistory(prev => [newRecord, ...prev].slice(0, 50)); // Keep last 50
      }
      
      setStreamData(frame);
    }, 1000 / 30);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen w-full bg-dark-900 text-slate-200 overflow-hidden font-sans">
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Background Ambient Glow */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary-500/10 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-accent-500/10 rounded-full blur-[100px] pointer-events-none"></div>

        {/* Top Header */}
        <header className="h-24
         flex items-center justify-between pt-6 px-6 border-b border-dark-700/50 bg-dark-800/80 backdrop-blur-md z-10 w-full">
          <div className="mb-6 flex justify-between items-end">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Tổng quan hệ thống</h2>
              <p className="text-sm text-slate-400 mt-1">Hệ thống giám sát và nhận diện biển số xe tự động.</p>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-6 z-10 custom-scroll">
          <SourceSelector onSourceSelect={setMediaSource} />

          <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {/* Main Video Stream */}
            <div className="lg:col-span-2 xl:col-span-3">
              <VideoPlayer 
                name={mediaSource ? mediaSource.name : "Camera AI Cổng chính"}
                streamData={streamData}
                status={mediaSource && mediaSource.type === 'stream' ? 'live' : mediaSource ? 'live' : 'offline'}
                source={mediaSource}
              />
            </div>

            {/* Side Panel: Detection History */}
            <div className="lg:col-span-1 h-[620px]">
              <DetectionHistory records={history} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const HistoryIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
    <path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
  </svg>
);

const ListIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);
