import React from 'react';
import type { SavedIncident } from '../types';

interface Props {
  incidents: SavedIncident[];
}

const dot: Record<string, string> = {
  SEV1: 'bg-sev1',
  SEV2: 'bg-sev2',
  SEV3: 'bg-sev3',
  UNKNOWN: 'bg-text-dim',
};

export const SimilarIncidents: React.FC<Props> = ({ incidents }) => {
  if (!incidents.length) return null;

  return (
    <div className="space-y-1.5">
      {incidents.map((inc) => (
        <div key={inc.id} className="flex items-center gap-2 text-xs">
          <div className={`w-1.5 h-1.5 rounded-full ${dot[inc.report.severity]}`} />
          <span className="text-text-muted flex-1 truncate">{inc.report.title}</span>
          <span className="text-2xs text-text-dim">{new Date(inc.createdAt).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
};