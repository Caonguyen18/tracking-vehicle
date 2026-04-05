import { useState, useEffect } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { DetectionHistory } from './components/DetectionHistory';
import { SourceSelector, type MediaSource } from './components/SourceSelector';
import { Car, Bike, Bus, Truck } from 'lucide-react';
import type { PlateRecord, StreamFrame, VideoAnalysisResult, Detection } from './types';

export default function App() {
  const [streamData, setStreamData] = useState<StreamFrame | null>(null);
  const [history, setHistory] = useState<PlateRecord[]>([]);
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysisResult | null>(null);

  // Calculate peak stats from analysis for the header summary
  const peakStats = videoAnalysis?.results.reduce((acc, frame) => {
    const frameStats: Record<string, number> = {};
    frame.detections.forEach((det: Detection) => {
      frameStats[det.type] = (frameStats[det.type] || 0) + 1;
    });
    Object.keys(frameStats).forEach(type => {
      acc[type] = Math.max(acc[type] || 0, frameStats[type]);
    });
    return acc;
  }, {} as Record<string, number>) || {};

  const summaryItems = [
    { label: 'Ô tô', icon: Car, color: 'text-blue-400', value: peakStats['Ô tô'] },
    { label: 'Xe máy', icon: Bike, color: 'text-emerald-400', value: peakStats['Xe máy'] },
    { label: 'Xe buýt', icon: Bus, color: 'text-amber-400', value: peakStats['Xe buýt'] },
    { label: 'Xe tải', icon: Truck, color: 'text-purple-400', value: peakStats['Xe tải'] },
  ];

  // Handle source selection and trigger analysis
  useEffect(() => {
    if (!mediaSource?.file) return;
    
    // Clear previous analysis state immediately before starting new one
    setIsProcessing(true);
    setVideoAnalysis(null);
    setStreamData(null);

    const abortController = new AbortController();

    if (mediaSource.type === 'image') {
      handleImageAnalysis(mediaSource.file, abortController.signal);
    } else if (mediaSource.type === 'video') {
      handleVideoAnalysis(mediaSource.file, abortController.signal);
    }

    return () => abortController.abort();
  }, [mediaSource]);

  const handleImageAnalysis = async (file: File, signal?: AbortSignal) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/analyze-image', {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) throw new Error('Analysis failed');

      const data = await response.json();
      console.log('Image Analysis Result:', data);
      
      const frame: StreamFrame = {
        camera_id: 'LOCAL-UPLOAD',
        timestamp: Date.now() / 1000,
        frame_id: 1,
        objects: data.detections.map((det: Detection, index: number) => ({
          id: `det_${index}`,
          track_id: index + 1,
          type: det.type,
          bbox: det.bbox,
          confidence: det.confidence,
          plate_text: det.plate_text,
          plate_crop: det.plate_crop
        }))
      };

      setStreamData(frame);

      // Batch history updates
      const newRecords = data.detections
        .filter((det: Detection) => det.plate_text && det.plate_text !== "[Không rõ]")
        .map((det: Detection) => ({
          id: `rec_${Date.now()}_${Math.random()}`,
          plate_text: det.plate_text!,
          plate_crop: det.plate_crop,
          camera_id: 'LOCAL-UPLOAD',
          timestamp: Date.now() / 1000,
          confidence: det.confidence
        }));
      
      if (newRecords.length > 0) {
        setHistory(prev => [...newRecords, ...prev].slice(0, 50));
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error analyzing image:', error);
      }
    } finally {
      if (!signal?.aborted) setIsProcessing(false);
    }
  };

  const handleVideoAnalysis = async (file: File, signal?: AbortSignal) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/analyze-video', {
        method: 'POST',
        body: formData,
        signal
      });

      if (!response.ok) throw new Error('Video analysis failed');

      const data = await response.json() as VideoAnalysisResult;
      setVideoAnalysis(data);

      // Populate history from video tracks
      const uniqueTracks = new Map<number, Detection>();
      data.results.forEach(frame => {
        frame.detections.forEach((det: Detection) => {
          if (det.plate_text && det.plate_text !== "[Không rõ]") {
            // Keep the one with highest confidence or the first one found with a crop
            const existing = uniqueTracks.get(det.track_id);
            if (!existing || (det.plate_crop && !existing.plate_crop)) {
              uniqueTracks.set(det.track_id, det);
            }
          }
        });
      });

      const videoRecords: PlateRecord[] = Array.from(uniqueTracks.values()).map((det: Detection) => ({
        id: `rec_v_${det.track_id}`,
        plate_text: det.plate_text!,
        plate_crop: det.plate_crop,
        camera_id: 'VIDEO-ANALYSIS',
        timestamp: Date.now() / 1000,
        confidence: det.confidence
      }));

      setHistory(videoRecords);
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error analyzing video:', error);
      }
    } finally {
      if (!signal?.aborted) setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#050505] text-slate-200 overflow-hidden font-sans selection:bg-primary-500/30 line-height-relaxed">
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative p-8">
        {/* Background Ambient Glow */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-500/5 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-accent-500/5 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="max-w-[1600px] mx-auto w-full flex flex-col h-full gap-6">
          {/* Compact Header & Source Selection */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              {summaryItems.map((item) => (
                <div key={item.label} className="flex items-center space-x-3 bg-dark-800/40 px-4 py-2 rounded-xl border border-white/5">
                  <div className={`p-1.5 rounded-lg bg-dark-900/50 ${item.color}`}>
                    <item.icon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter leading-none mb-1">{item.label}</span>
                    <span className="text-lg font-black text-white leading-none">
                      {item.value !== undefined ? item.value : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex-1 max-w-3xl">
              <SourceSelector onSourceSelect={setMediaSource} />
            </div>
          </div>

          {/* Main Dashboard Content */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8 min-h-0">
            {/* Main Video Stream */}
            <div className="lg:col-span-3 flex flex-col min-h-0">
              <div className="relative flex-1 bg-black rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
                {isProcessing && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-20 flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="text-white font-black uppercase tracking-widest text-[10px]">Analyzing Feed...</p>
                    </div>
                  </div>
                )}
                <VideoPlayer 
                  streamData={streamData}
                  status={mediaSource && mediaSource.type === 'stream' ? 'live' : mediaSource ? 'live' : 'offline'}
                  source={mediaSource}
                  videoAnalysis={videoAnalysis}
                />
              </div>
            </div>

            {/* Side Panel: Detection History & Traffic Summary */}
            <div className="lg:col-span-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scroll">
              <div className="flex-1 min-h-[300px]">
                <DetectionHistory records={history} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
