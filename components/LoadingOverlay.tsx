
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { AnalysisStatus } from '../types';

interface Props {
  progress: number;
  status: AnalysisStatus;
}

const steps = ['Uploading data...', 'Parsing logs and metrics...', 'Analyzing screenshots...', 'Synthesizing root cause...', 'Finalizing report...'];

export const LoadingOverlay: React.FC<Props> = ({ progress }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setStep((s) => (s + 1) % steps.length), 2000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95">
      <div className="text-center">
        <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto mb-3" />
        <div className="text-sm text-text mb-1">{steps[step]}</div>
        <div className="text-2xs text-text-dim mb-3">{Math.round(progress)}%</div>
        <div className="w-48 h-1 bg-border rounded overflow-hidden mx-auto">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
};
