
import React from 'react';
import { Trash2, ChevronRight } from 'lucide-react';
import type { SavedIncident } from '../types';

interface Props {
  incidents: SavedIncident[];
  onSelect: (i: SavedIncident) => void;
  onDelete: (id: string) => void;
}

const dot: Record<string, string> = {
  SEV1: 'bg-sev1',
  SEV2: 'bg-sev2',
  SEV3: 'bg-sev3',
  UNKNOWN: 'bg-text-dim',
};

export const IncidentHistory: React.FC<Props> = ({ incidents, onSelect, onDelete }) => {
  if (!incidents.length) {
    return <div className="text-center py-8 text-2xs text-text-dim">No incidents yet</div>;
  }

  return (
    <div className="space-y-1" role="list">
      {incidents.map((inc) => (
        <div
          key={inc.id}
          onClick={() => onSelect(inc)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(inc);
            }
          }}
          role="button"
          tabIndex={0}
          className="group flex items-center gap-2 p-2 hover:bg-bg-hover rounded cursor-pointer"
          aria-label={`Select incident: ${inc.report.title}`}
        >
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot[inc.report.severity]}`} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text truncate">{inc.report.title}</div>
            <div className="text-2xs text-text-dim">
              {new Date(inc.createdAt).toLocaleDateString()} · {inc.report.severity}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(inc.id);
            }}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-sev1/10 rounded text-text-dim hover:text-sev1"
            aria-label={`Delete incident ${inc.report.title}`}
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
          </button>
          <ChevronRight className="w-3 h-3 text-text-dim opacity-0 group-hover:opacity-100" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
};
