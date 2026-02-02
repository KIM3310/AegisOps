
import React from 'react';
import { BarChart2 } from 'lucide-react';
import type { TimelineEvent } from '../types';

interface Props {
  timeline: TimelineEvent[];
}

export const MetricsChart: React.FC<Props> = ({ timeline }) => {
  if (!timeline || timeline.length < 1) return null;

  // Extract latency metrics
  const data = timeline.map((e, i) => {
    const match = e.description.match(/(\d+(\.\d+)?)\s*(ms|s)/i);
    let value = 0;
    let hasValue = false;

    if (match && match[1] && match[3]) {
      hasValue = true;
      const rawVal = parseFloat(match[1]);
      const unit = match[3].toLowerCase();
      value = unit === 's' ? rawVal * 1000 : rawVal;
    }

    return {
      i,
      v: value,
      hasValue,
      desc: e.description,
      err: e.severity === 'critical' || /error|fail|crash|outage/i.test(e.description),
    };
  }).filter(d => d.hasValue);

  // Empty State Handling
  if (data.length === 0) {
    return (
      <div className="mt-4 pt-6 border-t border-border/50 flex flex-col items-center justify-center py-8 text-text-dim/50 gap-2">
        <div className="p-3 rounded-full bg-bg border border-border/50">
           <BarChart2 className="w-5 h-5" />
        </div>
        <span className="text-xs font-medium">No numerical metrics detected in logs</span>
      </div>
    );
  }

  // Safe Math
  const max = Math.max(...data.map((d) => d.v));
  const safeMax = max > 0 ? max : 100;
  const avg = data.reduce((acc, curr) => acc + curr.v, 0) / data.length;
  const avgPercent = (avg / safeMax) * 100;
  const peakIndex = data.findIndex(d => d.v === max);

  return (
    <div className="space-y-4 mt-6 pt-6 border-t border-border/50">
      <div className="flex items-center justify-between px-1">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider flex items-center gap-2">
            Latency Trend <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </span>
        </div>
        <div className="flex gap-4 text-2xs font-mono">
          <div className="flex items-center gap-1.5 bg-bg px-2 py-0.5 rounded border border-border">
            <span className="text-text-muted">Avg</span>
            <span className="text-text font-medium">{Math.round(avg)}ms</span>
          </div>
          <div className="flex items-center gap-1.5 bg-sev1/10 px-2 py-0.5 rounded border border-sev1/20">
            <span className="text-sev1">Peak</span>
            <span className="text-sev1 font-bold">{Math.round(max)}ms</span>
          </div>
        </div>
      </div>
      
      {/* Scrollable Container */}
      <div className="overflow-x-auto pb-4 scrollbar-thin">
        <div className="relative h-32 flex items-end gap-1.5 pb-2 border-b border-border min-w-full w-max px-1" role="img" aria-label="Latency metrics visualization chart">
          
          {/* Grid Lines (Fixed width to ensure they span the full scrollable area) */}
          {[25, 50, 75].map((p) => (
              <div key={p} className="absolute left-0 right-0 border-t border-border/10 z-0 pointer-events-none" style={{ bottom: `${p}%` }} />
          ))}

          {/* Average Line */}
          <div 
              className="absolute left-0 right-0 border-t border-dashed border-text-dim/50 z-0 pointer-events-none" 
              style={{ bottom: `${Math.min(Math.max(avgPercent, 0), 100)}%` }}
          />

          {data.map((d, index) => {
            const height = Math.max((d.v / safeMax) * 100, 4);
            const isPeak = index === peakIndex && d.v > 0;
            
            return (
              <div key={d.i} className="flex-1 flex flex-col items-center group relative z-10 h-full justify-end min-w-[8px]">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center bg-bg-card border border-border px-2.5 py-1.5 rounded-lg shadow-xl z-20 whitespace-nowrap animate-in fade-in slide-in-from-bottom-1 duration-200 pointer-events-none">
                    <div className="text-xs font-bold text-text">{Math.round(d.v)}ms</div>
                    <div className="text-[9px] text-text-dim">{d.desc.substring(0, 20)}...</div>
                    {/* Arrow */}
                    <div className="w-2 h-2 bg-bg-card border-r border-b border-border rotate-45 absolute -bottom-1"></div>
                </div>
                
                {/* Peak Marker */}
                {isPeak && (
                  <div className="absolute -top-4 flex flex-col items-center pointer-events-none">
                      <div className="text-[8px] text-sev1 font-bold">MAX</div>
                      <div className="w-px h-1.5 bg-sev1/50"></div>
                  </div>
                )}

                {/* Bar */}
                <div
                  className={`w-full max-w-[20px] rounded-t-sm transition-all duration-300 relative overflow-hidden ${d.err ? 'bg-gradient-to-t from-sev1/40 to-sev1/80 group-hover:to-sev1' : 'bg-gradient-to-t from-accent/30 to-accent/60 group-hover:to-accent'}`}
                  style={{ height: `${Math.min(height, 100)}%` }}
                >
                    {d.v > avg * 1.5 && !d.err && (
                        <div className="absolute top-0 inset-x-0 h-[2px] bg-yellow-400/80 shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
