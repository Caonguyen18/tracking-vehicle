import React, { useState, useRef } from 'react';
import { Upload, Link2 } from 'lucide-react';
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
    
    onSourceSelect({ type, url, name: file.name, file });
  };

  const handleStreamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!streamUrl) return;
    
    onSourceSelect({ type: 'stream', url: streamUrl, name: streamUrl });
    setStreamUrl('');
  };

  return (
    <div className="bg-dark-800/10 backdrop-blur-3xl rounded-2xl border border-white/5 p-1.5 overflow-hidden group w-full">
      <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6">
        {/* Compact Tabs */}
        <div className="flex bg-black/40 backdrop-blur-md p-1 rounded-xl border border-white/5 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('upload')}
            className={cn(
              "px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all duration-300",
              activeTab === 'upload' 
                ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20" 
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            Tải lên File
          </button>
          <button
            onClick={() => setActiveTab('stream')}
            className={cn(
              "px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all duration-300",
              activeTab === 'stream' 
                ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20" 
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            Đường dẫn Stream
          </button>
        </div>

        {/* Dynamic Content Bar */}
        <div className="flex-1 w-full">
          {activeTab === 'upload' ? (
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/30 text-primary-400 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center group/btn"
              >
                <Upload className="w-3.5 h-3.5 mr-2 group-hover/btn:-translate-y-0.5 transition-transform" />
                Chọn Video hoặc Hình ảnh
              </button>
              <span className="text-[10px] font-bold text-slate-500 hidden md:block uppercase tracking-widest">
                MP4, WebM, JPG, PNG (Max 100MB)
              </span>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="video/*,image/*" 
                className="hidden" 
              />
            </div>
          ) : (
            <form onSubmit={handleStreamSubmit} className="flex space-x-3 w-full">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Link2 className="text-primary-400 w-3.5 h-3.5" />
                </div>
                <input 
                  type="text" 
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="Nhập đường dẫn stream RTSP, HTTP, hoặc WebSocket..." 
                  className="w-full bg-black/40 border border-white/5 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none focus:border-primary-500/50 transition-all font-medium placeholder:text-slate-600"
                />
              </div>
              <button 
                type="submit"
                disabled={!streamUrl}
                className="bg-primary-500 hover:bg-primary-600 disabled:opacity-30 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-primary-500/10"
              >
                Kết nối
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
