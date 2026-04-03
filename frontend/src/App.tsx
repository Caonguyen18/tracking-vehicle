import { useState, useEffect } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { DetectionHistory } from './components/DetectionHistory';
import { SourceSelector, type MediaSource } from './components/SourceSelector';
import type { PlateRecord, StreamFrame } from './types';

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
  const [isProcessing, setIsProcessing] = useState(false);

  // Handle source selection and trigger analysis if it's an image
  useEffect(() => {
    if (mediaSource?.type === 'image' && mediaSource.file) {
      handleImageAnalysis(mediaSource.file);
    }
  }, [mediaSource]);

  const handleImageAnalysis = async (file: File) => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/analyze-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Analysis failed');

      const data = await response.json();
      
      // Map backend response to StreamFrame
      const frame: StreamFrame = {
        camera_id: 'LOCAL-UPLOAD',
        timestamp: Date.now() / 1000,
        frame_id: 1,
        objects: data.detections.map((det: any, index: number) => ({
          id: `det_${index}`,
          track_id: index + 1,
          type: det.type,
          // Backend returns [x1, y1, x2, y2], frontend wants {x, y, width, height}
          bbox: {
            x: det.bbox[0],
            y: det.bbox[1],
            width: det.bbox[2] - det.bbox[0],
            height: det.bbox[3] - det.bbox[1]
          },
          confidence: det.confidence,
          plate_text: det.license_plate || undefined
        }))
      };

      setStreamData(frame);

      // Add to history if a plate was found
      data.detections.forEach((det: any) => {
        if (det.license_plate) {
          const newRecord: PlateRecord = {
            id: `rec_${Date.now()}_${Math.random()}`,
            plate_text: det.license_plate,
            camera_id: 'LOCAL-UPLOAD',
            timestamp: Date.now() / 1000,
            confidence: 0.95
          };
          setHistory(prev => [newRecord, ...prev].slice(0, 50));
        }
      });

    } catch (error) {
      console.error('Error analyzing image:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Mock WebSocket Connection (Only active if no real media source is selected or if it's a stream)
  useEffect(() => {
    if (mediaSource?.type === 'image') {
      console.log('Disabling mock data for image analysis');
      return;
    }
    
    let frameCount = 0;
    const interval = setInterval(() => {
      // Simulation logic...
      frameCount++;
      // ... (code omitted for brevity in thought, but I must include the actual code in replacement)
      // Wait, I should include the actual code to avoid breaking the file.
      
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

      if (frameCount % 45 === 0) {
        const newPlateText = generatePlate();
        frame.objects.push({
          id: `p_${frameCount}`,
          track_id: 1042,
          type: 'plate',
          bbox: { x: baseX + 150, y: baseY + 250, width: 120, height: 40 },
          confidence: 0.98 + (Math.random() * 0.01),
          plate_text: newPlateText
        });
        
        const newRecord: PlateRecord = {
          id: `rec_${Date.now()}`,
          plate_text: newPlateText,
          camera_id: 'CAM-01',
          timestamp: Date.now() / 1000,
          confidence: 0.98
        };
        setHistory(prev => [newRecord, ...prev].slice(0, 50));
      }
      
      setStreamData(frame);
    }, 1000 / 30);

    return () => {
      console.log('Clearing mock interval');
      clearInterval(interval);
    };
  }, [mediaSource]);

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
              <div className="relative">
                {isProcessing && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-20 flex items-center justify-center rounded-xl">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                      <p className="text-white font-medium">Đang phân tích hình ảnh...</p>
                    </div>
                  </div>
                )}
                <VideoPlayer 
                  name={mediaSource ? mediaSource.name : "Camera AI Cổng chính"}
                  streamData={streamData}
                  status={mediaSource && mediaSource.type === 'stream' ? 'live' : mediaSource ? 'live' : 'offline'}
                  source={mediaSource}
                />
              </div>
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
