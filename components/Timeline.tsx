
import React from 'react';
import type { TimelineEvent } from '../types';

interface Props {
  events: TimelineEvent[];
}

const formatTime = (timeStr: string): string => {
  if (!timeStr) return '';
  
  // 1. Try ISO Format (T split) - e.g. 2025-01-01T10:00:00Z
  if (timeStr.includes('T')) {
      const parts = timeStr.split('T');
      if (parts[1]) return parts[1].substring(0, 8); // HH:mm:ss
  }
  
  // 2. Robust Regex for Time extraction
  // Supports: 09:00, 9:00, 09:00:00, 09:00:00.123
  const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)/;
  const match = timeStr.match(timeRegex);
  
  if (match) {
    // If it has milliseconds, truncate them for cleaner display
    return match[1].split('.')[0]; 
  }

  // 3. Fallback: return first 8 chars (usually HH:mm:ss) or full string if short
  return timeStr.length > 8 ? timeStr.substring(0, 8) : timeStr;
};

export const Timeline: React.FC<Props> = ({ events }) => (
  <div className="pl-2 py-2" role="list" aria-label="Incident Timeline">
    {events.map((e, i) => {
      const isLast = i === events.length - 1;
      
      const isErr = e.severity === 'critical' || /error|fail|outage|crash/i.test(e.description);
      const isWarn = e.severity === 'warning' || /warn|alert|threshold/i.test(e.description);
      const isOk = e.severity === 'success' || /recover|fixed|resolved/i.test(e.description);
      
      let dotClass = 'bg-bg-card border-text-dim';
      let textClass = 'text-text-muted';

      if (isErr) { dotClass = 'bg-sev1 border-sev1'; textClass = 'text-sev1 font-medium'; }
      else if (isWarn) { dotClass = 'bg-sev2 border-sev2'; textClass = 'text-sev2'; }
      else if (isOk) { dotClass = 'bg-green-500 border-green-500'; textClass = 'text-green-500'; }

      return (
        <div key={i} className="flex gap-4 relative group">
          {/* 
            Connector Line Logic:
            The dot is w-3 (12px). Center is at 6px.
            The line is 1px wide.
            So left = 6px (center) - 0.5px (half width) = 5.5px.
            Top starts from center of dot (approx 6px down + padding). 
            Height extends to the next item's dot top.
          */}
          {!isLast && (
            <div 
              className="absolute w-px bg-border group-hover:bg-border/80 transition-colors"
              style={{ 
                left: '5.5px',
                top: '18px', // Start below the current dot
                bottom: '-6px' // Extend to the top of next dot
              }}
              aria-hidden="true" 
            />
          )}

          {/* Dot */}
          <div className="flex-shrink-0 pt-1.5 relative z-10">
            <div className={`w-3 h-3 rounded-full border ${dotClass} shadow-sm ring-4 ring-bg group-hover:scale-110 transition-transform duration-200`} />
          </div>

          {/* Content */}
          <div className="flex-1 pb-8 min-w-0">
            <div className="text-[10px] text-text-dim font-mono mb-1 leading-none select-none flex items-center gap-2">
              {formatTime(e.time)}
              {isErr && <span className="px-1 py-0.5 rounded-[2px] bg-sev1/10 text-sev1 font-bold tracking-wider text-[9px]">ERR</span>}
            </div>
            <div className={`text-sm leading-relaxed break-words ${textClass}`}>
              {e.description}
            </div>
          </div>
        </div>
      );
    })}
  </div>
);
