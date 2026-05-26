import { useState, useEffect } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { DetectionHistory } from './components/DetectionHistory';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { SourceSelector, type MediaSource } from './components/SourceSelector';
import { Car, Bike, Bus, Truck, LayoutList, BarChart3 } from 'lucide-react';
import type { PlateRecord, StreamFrame, VideoAnalysisResult, Detection } from './types';

export default function App() {
  const [streamData, setStreamData] = useState<StreamFrame | null>(null);
  const [history, setHistory] = useState<PlateRecord[]>([]);
  const [allRecords, setAllRecords] = useState<PlateRecord[]>([]);
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysisResult | null>(null);
  const [seekTimestamp, setSeekTimestamp] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'analytics'>('history');

  const handleRecordClick = (timestamp: number) => {
    // We add a tiny offset or use a state object if we want to support clicking the same record twice
    // but for now, simple timestamp is fine.
    setSeekTimestamp(timestamp);
    // Reset after a short delay so the same timestamp can be clicked again
    setTimeout(() => setSeekTimestamp(null), 100);
  };

  // Calculate total stats from all tracked records for the header summary
  const totalStats = allRecords.reduce((acc, rec) => {
    acc[rec.vehicle_type] = (acc[rec.vehicle_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summaryItems = [
    { label: 'Ô tô', icon: Car, color: 'text-blue-400', value: totalStats['Ô tô'] },
    { label: 'Xe máy', icon: Bike, color: 'text-emerald-400', value: totalStats['Xe máy'] },
    { label: 'Xe buýt', icon: Bus, color: 'text-amber-400', value: totalStats['Xe buýt'] },
    { label: 'Xe tải', icon: Truck, color: 'text-purple-400', value: totalStats['Xe tải'] },
  ];

  // Handle source selection and trigger analysis
  useEffect(() => {
    if (!mediaSource?.file) return;
    
    // Clear previous analysis state immediately before starting new one
    setIsProcessing(true);
    setVideoAnalysis(null);
    setStreamData(null);
    setAllRecords([]);
    setHistory([]);

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
          plate_crop: det.plate_crop,
          plate_bbox: det.plate_bbox
        }))
      };

      setStreamData(frame);

      const allParsedRecords: PlateRecord[] = data.detections.map((det: Detection, idx: number) => ({
        id: `all_rec_${Date.now()}_${idx}`,
        plate_text: det.plate_text || '',
        vehicle_type: det.type,
        plate_crop: det.plate_crop,
        camera_id: 'LOCAL-UPLOAD',
        timestamp: Date.now() / 1000,
        confidence: det.confidence
      }));
      setAllRecords(prev => [...allParsedRecords, ...prev]);

      // Batch history updates (only for those with plates)
      const newRecords: PlateRecord[] = allParsedRecords.filter(rec => rec.plate_text && rec.plate_text !== "[Không rõ]");
      
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

      // Populate history from video tracks with timing metadata
      const trackAggregates = new Map<number, {
        bestDet: Detection;
        startTime: number;
        endTime: number;
      }>();

      data.results.forEach(frame => {
        frame.detections.forEach((det: Detection) => {
          const existing = trackAggregates.get(det.track_id);
          if (!existing) {
            trackAggregates.set(det.track_id, {
              bestDet: det,
              startTime: frame.timestamp,
              endTime: frame.timestamp
            });
          } else {
            // Update duration
            existing.startTime = Math.min(existing.startTime, frame.timestamp);
            existing.endTime = Math.max(existing.endTime, frame.timestamp);
            
            // Update best detection (prefer one with plate_crop and higher confidence)
            const currentScore = (det.plate_crop ? 1 : 0) + det.confidence;
            const existingScore = (existing.bestDet.plate_crop ? 1 : 0) + existing.bestDet.confidence;
            
            if (currentScore > existingScore) {
              existing.bestDet = det;
            }
          }
        });
      });

      const allVideoRecords: PlateRecord[] = Array.from(trackAggregates.values()).map(({ bestDet, startTime, endTime }) => ({
        id: `rec_v_${bestDet.track_id}`,
        plate_text: bestDet.plate_text || '',
        vehicle_type: bestDet.type,
        plate_crop: bestDet.plate_crop,
        camera_id: 'VIDEO-ANALYSIS',
        timestamp: Date.now() / 1000,
        confidence: bestDet.confidence,
        video_start_time: startTime,
        video_duration: endTime - startTime
      }));

      setAllRecords(allVideoRecords);

      const videoHistoryRecords = allVideoRecords.filter(rec => rec.plate_text && rec.plate_text !== "[Không rõ]");
      setHistory(videoHistoryRecords);
      
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
                  seekTo={seekTimestamp ?? undefined}
                />
              </div>
            </div>

            {/* Side Panel: Detection History & Traffic Summary */}
            <div className="lg:col-span-1 flex flex-col gap-4 min-h-[300px]">
              {/* Tab Switcher */}
              <div className="flex items-center p-1 bg-dark-800/40 border border-dark-700/50 rounded-xl backdrop-blur-xl">
                <button
                  onClick={() => setActiveTab('history')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'history' 
                    ? 'bg-primary-500/20 text-primary-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <LayoutList className="w-4 h-4" />
                  <span>Lịch sử</span>
                </button>
                <button
                  onClick={() => setActiveTab('analytics')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'analytics' 
                    ? 'bg-primary-500/20 text-primary-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  <span>Thống kê</span>
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 min-h-0 relative">
                {activeTab === 'history' ? (
                  <DetectionHistory 
                    records={history} 
                    onRecordClick={handleRecordClick}
                  />
                ) : (
                  <AnalyticsDashboard records={allRecords} />
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
