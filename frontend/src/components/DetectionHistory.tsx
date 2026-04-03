import React from 'react';
import { format } from 'date-fns';
import type { PlateRecord } from '../types';
import { Camera, Clock, CheckCircle } from 'lucide-react';

export const DetectionHistory: React.FC<{ records: PlateRecord[] }> = ({ records }) => {
  return (
    <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden flex flex-col h-full bg-opacity-70 backdrop-blur-md">
      <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center">
          <HistoryIcon className="w-5 h-5 mr-2 text-primary-400" />
          Lịch sử quét
        </h2>
        <span className="text-xs font-medium bg-dark-700 text-slate-300 py-1 px-3 rounded-full">
          Cập nhật trực tiếp
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 custom-scroll">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Scan className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">Đang đợi dữ liệu...</p>
          </div>
        ) : (
          records.slice(0, 10).map((record) => (
            <div key={record.id} className="bg-dark-900 border border-dark-700 rounded-xl p-4 flex flex-col hover:border-primary-500/50 transition-colors group relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary-400 to-accent-500 rounded-l-xl opacity-70 group-hover:opacity-100 transition-opacity"></div>
              
              <div className="flex justify-between items-start mb-3 ml-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xl font-mono font-bold text-white tracking-wider bg-dark-700 px-3 py-1 rounded-md shadow-inner border border-dark-600">
                      {record.plate_text}
                    </span>
                    {record.confidence > 0.85 && (
                      <CheckCircle className="w-4 h-4 text-accent-500" />
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-accent-500/10 text-accent-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    {(record.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs text-slate-400 mt-2 ml-2">
                <div className="flex items-center">
                  <Camera className="w-3.5 h-3.5 mr-1" />
                  <span>{record.camera_id}</span>
                </div>
                <div className="flex items-center">
                  <Clock className="w-3.5 h-3.5 mr-1" />
                  <span>{format(new Date(record.timestamp * 1000), 'HH:mm:ss')}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// Quick icons
const HistoryIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
    <path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
  </svg>
);
const Scan = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>
);
