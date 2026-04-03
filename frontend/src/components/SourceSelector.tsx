import React, { useState, useRef } from 'react';
import { Upload, Link2, FileVideo, Image as ImageIcon } from 'lucide-react';
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export type SourceType = 'stream' | 'video' | 'image';

export interface MediaSource {
  type: SourceType;
  url: string;
  name: string;
  file?: File;
}

interface SourceSelectorProps {
  onSourceSelect: (source: MediaSource) => void;
}

export const SourceSelector: React.FC<SourceSelectorProps> = ({ onSourceSelect }) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'stream'>('upload');
  const [streamUrl, setStreamUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const type: SourceType = file.type.startsWith('video/') ? 'video' : 'image';
    const url = URL.createObjectURL(file);
    
    onSourceSelect({
      type,
      url,
      name: file.name,
      file
    });
  };

  const handleStreamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!streamUrl) return;
    
    onSourceSelect({
      type: 'stream',
      url: streamUrl,
      name: streamUrl
    });
    setStreamUrl('');
  };

  return (
    <div className="bg-dark-800/80 backdrop-blur-md rounded-xl border border-dark-700 p-5 mb-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
        <Upload className="w-5 h-5 mr-2 text-primary-400" />
        Cấu hình nguồn đầu vào
      </h3>
      
      <div className="flex space-x-1 mb-5 bg-dark-900/50 p-1 rounded-lg w-full max-w-sm">
        <button
          onClick={() => setActiveTab('upload')}
          className={cn(
            "flex-1 py-1.5 text-sm font-medium rounded-md transition-colors",
            activeTab === 'upload' 
              ? "bg-dark-700 text-white shadow-sm" 
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Tải lên File
        </button>
        <button
          onClick={() => setActiveTab('stream')}
          className={cn(
            "flex-1 py-1.5 text-sm font-medium rounded-md transition-colors",
            activeTab === 'stream' 
              ? "bg-dark-700 text-white shadow-sm" 
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Đường dẫn Stream
        </button>
      </div>

      {activeTab === 'upload' && (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-32 border-2 border-dashed border-dark-600 hover:border-primary-500/50 hover:bg-dark-700/30 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all group"
        >
          <div className="flex space-x-3 mb-2">
            <div className="p-2 bg-dark-900 rounded-full group-hover:bg-primary-500/20 group-hover:text-primary-400 transition-colors">
              <FileVideo className="w-6 h-6 text-slate-400 group-hover:text-primary-400" />
            </div>
            <div className="p-2 bg-dark-900 rounded-full group-hover:bg-accent-500/20 group-hover:text-accent-400 transition-colors">
              <ImageIcon className="w-6 h-6 text-slate-400 group-hover:text-accent-400" />
            </div>
          </div>
          <p className="text-sm text-slate-300 font-medium">Nhấn để tải lên video hoặc hình ảnh</p>
          <p className="text-xs text-slate-500 mt-1">Hỗ trợ MP4, WebM, JPG, PNG</p>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="video/*,image/*" 
            className="hidden" 
          />
        </div>
      )}

      {activeTab === 'stream' && (
        <form onSubmit={handleStreamSubmit} className="flex space-x-3">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="Nhập đường dẫn stream RTSP, HTTP, hoặc WebSocket..." 
              className="w-full bg-dark-900 border border-dark-600 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <button 
            type="submit"
            disabled={!streamUrl}
            className="bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            Kết nối
          </button>
        </form>
      )}
    </div>
  );
};
