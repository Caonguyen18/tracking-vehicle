import React from 'react';
import { format } from 'date-fns';
import type { PlateRecord } from '../types';
import { Camera, Clock, Download, Car, Bike, Bus, Truck, Info, Timer, Hourglass, Search, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const formatVideoTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const DetectionHistory: React.FC<{ 
  records: PlateRecord[],
  onRecordClick?: (timestamp: number) => void 
}> = ({ records, onRecordClick }) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');

  const filteredRecords = React.useMemo(() => {
    return records.filter(record => {
      const matchesSearch = record.plate_text.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'all' || record.vehicle_type.toLowerCase() === typeFilter.toLowerCase();
      return matchesSearch && matchesType;
    });
  }, [records, searchTerm, typeFilter]);

  const vehicleTypes = React.useMemo(() => {
    const types = new Set(records.map(r => r.vehicle_type));
    return Array.from(types);
  }, [records]);

  const exportToExcel = () => {
    if (records.length === 0) return;

    const data = filteredRecords.map(record => ({
      'ID': record.id,
      'Biển số': record.plate_text,
      'Loại xe': record.vehicle_type,
      'Độ tin cậy': `${Math.round(record.confidence * 100)}%`,
      'Camera': record.camera_id,
      'Xuất hiện (Video)': record.video_start_time !== undefined ? formatVideoTime(record.video_start_time) : 'N/A',
      'Thời lượng (giây)': record.video_duration !== undefined ? `${record.video_duration.toFixed(1)}s` : 'N/A',
      'Thời gian quét': format(new Date(record.timestamp * 1000), 'HH:mm:ss dd/MM/yyyy')
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'History');
    
    // Generate buffer
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
    
    saveAs(blob, `lich_su_quet_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  const getVehicleIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('ô tô') || t.includes('car')) return Car;
    if (t.includes('xe máy') || t.includes('motorcycle')) return Bike;
    if (t.includes('xe buýt') || t.includes('bus')) return Bus;
    if (t.includes('xe tải') || t.includes('truck')) return Truck;
    return Info;
  };

  return (
    <div className="bg-dark-800/40 rounded-2xl border border-dark-700/50 overflow-hidden flex flex-col h-full backdrop-blur-xl shadow-2xl relative">
      {/* Decorative gradient corner */}
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-primary-500/10 rounded-full blur-2xl pointer-events-none"></div>
      
      
      <div className="px-6 py-5 border-b border-dark-700/50 flex flex-col gap-4 bg-dark-800/40">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center tracking-tight">
            <HistoryIcon className="w-5 h-5 mr-3 text-primary-400 stroke-[2.5px]" />
            Lịch sử quét
          </h2>
          <div className="flex items-center space-x-3">
            <button 
              onClick={exportToExcel}
              disabled={filteredRecords.length === 0}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed group"
              title="Xuất Excel"
            >
              <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </button>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-accent-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">
                Live
              </span>
            </div>
          </div>
        </div>

        {/* Search and Filter UI */}
        <div className="flex flex-col gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 group-focus-within:text-primary-400 transition-colors" />
            <input 
              type="text"
              placeholder="Tìm biển số..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-dark-900/60 border border-dark-700/50 rounded-xl py-2 pl-9 pr-4 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/20 transition-all"
            />
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setTypeFilter('all')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                typeFilter === 'all' 
                ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' 
                : 'bg-dark-900/40 text-slate-500 hover:text-slate-300 border border-dark-700/30'
              }`}
            >
              Tất cả
            </button>
            {vehicleTypes.map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  typeFilter === type 
                  ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20' 
                  : 'bg-dark-900/40 text-slate-500 hover:text-slate-300 border border-dark-700/30'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scroll">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-20">
            <div className="relative mb-4">
              <Scan className="w-16 h-16 opacity-10 animate-pulse" />
              <div className="absolute inset-0 bg-primary-500/5 blur-xl rounded-full"></div>
            </div>
            <p className="text-sm font-medium tracking-wide">
              {searchTerm || typeFilter !== 'all' ? 'Không tìm thấy kết quả' : 'Đang đợi dữ liệu...'}
            </p>
          </div>
        ) : (
          filteredRecords.map((record, index) => {
            const VehicleIcon = getVehicleIcon(record.vehicle_type);
            const canJump = record.video_start_time !== undefined;
            return (
              <div 
                key={record.id} 
                onClick={() => canJump && onRecordClick?.(record.video_start_time!)}
                className={`group relative bg-dark-900/40 border border-dark-700/50 hover:border-primary-500/40 rounded-2xl p-4 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:-translate-y-0.5 ${canJump ? 'cursor-pointer' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Identification Pill */}
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center space-x-2">
                    <div className="bg-primary-500/10 p-1.5 rounded-lg">
                      <VehicleIcon className="w-3.5 h-3.5 text-primary-400" />
                    </div>
                    <span className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">
                      {record.vehicle_type}
                    </span>
                  </div>
                  <div className="bg-accent-500/10 px-2 py-0.5 rounded-full border border-accent-500/20">
                    <span className="text-[10px] font-black text-accent-400">
                      {Math.round(record.confidence * 100)}% Match
                    </span>
                  </div>
                </div>

                {/* Plate Display */}
                <div className="bg-white/5 border border-white/5 rounded-xl p-3 mb-4 flex flex-col items-center justify-center relative overflow-hidden group-hover:bg-white/10 transition-colors">
                  <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                  
                  {record.plate_crop && (
                    <img 
                      src={`data:image/jpeg;base64,${record.plate_crop}`} 
                      alt="Plate Crop" 
                      className="w-full h-16 object-contain rounded-lg mb-3 opacity-70 group-hover:opacity-100 transition-opacity border border-white/10"
                    />
                  )}

                  <span className="text-2xl font-mono font-black text-white tracking-[0.2em] drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                    {record.plate_text}
                  </span>
                </div>
                
                {/* Meta Info */}
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <div className="flex items-center bg-dark-800/50 py-1.5 px-3 rounded-lg border border-dark-700/30">
                    <Camera className="w-3 h-3 mr-2 text-slate-400" />
                    <span className="truncate">{record.camera_id}</span>
                  </div>
                  <div className="flex items-center bg-dark-800/50 py-1.5 px-3 rounded-lg border border-dark-700/30">
                    <Clock className="w-3 h-3 mr-2 text-slate-400" />
                    <span>{format(new Date(record.timestamp * 1000), 'HH:mm dd/MM')}</span>
                  </div>

                  {record.video_start_time !== undefined && (
                    <>
                      <div className="flex items-center bg-dark-800/50 py-1.5 px-3 rounded-lg border border-dark-700/30">
                        <Timer className="w-3 h-3 mr-2 text-primary-400" />
                        <span className="text-primary-400">Từ {formatVideoTime(record.video_start_time)}</span>
                      </div>
                      <div className="flex items-center bg-dark-800/50 py-1.5 px-3 rounded-lg border border-dark-700/30">
                        <Hourglass className="w-3 h-3 mr-2 text-emerald-400" />
                        <span className="text-emerald-400">{record.video_duration?.toFixed(1)}s</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
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
