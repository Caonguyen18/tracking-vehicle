import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Activity, PieChart as PieChartIcon } from 'lucide-react';
import type { PlateRecord } from '../types';

interface AnalyticsDashboardProps {
  records: PlateRecord[];
}

const COLORS = {
  'Ô tô': '#3B82F6', // Blue
  'Xe máy': '#10B981', // Emerald
  'Xe buýt': '#F59E0B', // Amber
  'Xe tải': '#8B5CF6', // Purple
  'Khác': '#64748B' // Slate
};

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ records }) => {
  const typeData = useMemo(() => {
    const counts = records.reduce((acc, rec) => {
      const type = rec.vehicle_type || 'Khác';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.keys(counts).map(key => ({
      name: key,
      value: counts[key]
    })).sort((a, b) => b.value - a.value);
  }, [records]);

  const timelineData = useMemo(() => {
    if (records.length === 0) return [];

    // Simple binning logic: group by 10-second intervals based on start time
    const bins = new Map<number, number>();
    records.forEach(rec => {
      // Use video_start_time if available (for videos), otherwise use general timestamp
      const timeRef = rec.video_start_time ?? rec.timestamp;
      const bin = Math.floor(timeRef / 10) * 10; 
      bins.set(bin, (bins.get(bin) || 0) + 1);
    });

    const sortedBins = Array.from(bins.entries()).sort((a, b) => a[0] - b[0]);
    if (sortedBins.length === 0) return [];

    const minTime = sortedBins[0][0];

    return sortedBins.map(([bin, count]) => {
      const relativeTime = bin - minTime;
      const mins = Math.floor(relativeTime / 60);
      const secs = Math.floor(relativeTime % 60);
      return {
        timeStr: `${mins}:${secs.toString().padStart(2, '0')}`,
        count
      };
    });
  }, [records]);

  const topVehicle = typeData.length > 0 ? typeData[0].name : '-';
  const peakTrafficCount = timelineData.length > 0 ? Math.max(...timelineData.map(d => d.count)) : 0;
  const totalCount = records.length;

  return (
    <div className="bg-dark-800/40 rounded-2xl border border-dark-700/50 flex flex-col h-full backdrop-blur-xl shadow-2xl overflow-y-auto custom-scroll relative">
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-500/5 rounded-full blur-[80px] pointer-events-none"></div>
      
      <div className="p-4 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-dark-900/60 border border-dark-700/50 rounded-xl p-3">
            <h3 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Tổng lượt xe</h3>
            <p className="text-2xl font-black text-white">{totalCount}</p>
          </div>
          <div className="bg-dark-900/60 border border-dark-700/50 rounded-xl p-3">
            <h3 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Loài xe nhiều nhất</h3>
            <p className="text-lg font-black text-primary-400 truncate">{topVehicle}</p>
          </div>
        </div>

        {/* Vehicle Type Distribution */}
        <div className="bg-dark-900/40 border border-dark-700/30 rounded-xl p-4">
          <div className="flex items-center mb-4">
            <PieChartIcon className="w-4 h-4 text-emerald-400 mr-2" />
            <h3 className="text-sm font-bold text-white tracking-tight">Phân bổ loại xe</h3>
          </div>
          <div className="h-48 w-full">
            {records.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {typeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS] || COLORS['Khác']} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-slate-500">Chưa có dữ liệu</div>
            )}
          </div>
          
          {/* Custom Legend */}
          <div className="flex flex-wrap gap-2 mt-2 justify-center">
            {typeData.map(entry => (
              <div key={entry.name} className="flex items-center text-[10px] text-slate-400">
                <div 
                  className="w-2 h-2 rounded-full mr-1.5" 
                  style={{ backgroundColor: COLORS[entry.name as keyof typeof COLORS] || COLORS['Khác'] }}
                ></div>
                {entry.name} ({entry.value})
              </div>
            ))}
          </div>
        </div>

        {/* Traffic Over Time */}
        <div className="bg-dark-900/40 border border-dark-700/30 rounded-xl p-4">
          <div className="flex items-center mb-4">
            <Activity className="w-4 h-4 text-primary-400 mr-2" />
            <h3 className="text-sm font-bold text-white tracking-tight">Lưu lượng (Xe / 10s)</h3>
          </div>
          <div className="h-40 w-full">
            {timelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                  <XAxis 
                    dataKey="timeStr" 
                    stroke="#64748B" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                    minTickGap={20}
                  />
                  <YAxis 
                    stroke="#64748B" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#94a3b8', fontSize: '10px', marginBottom: '4px' }}
                    itemStyle={{ color: '#3B82F6', fontSize: '12px', fontWeight: 'bold' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="count" 
                    name="Số lượng"
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorCount)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-slate-500">Chưa có dữ liệu</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
