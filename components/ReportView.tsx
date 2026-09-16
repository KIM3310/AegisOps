
import React from 'react';
import { X, Edit3, RefreshCw } from 'lucide-react';
import { ReportCard } from './ReportCard';
import type { IncidentReport } from '../types';
import type { CaseSubmission } from '../shared/responseCase';
import { ResponseWorkflowCard } from './ResponseWorkflowCard';

interface ReportViewProps {
  report: IncidentReport;
  responseSubmission: CaseSubmission | null;
  enableGrounding: boolean;
  ttsAvailable: boolean | undefined;
  onStartNew: () => void;
  onEditInputs: () => void;
  onReAnalyze: () => void;
}

export function ReportView({ report, responseSubmission, enableGrounding, ttsAvailable, onStartNew, onEditInputs, onReAnalyze }: ReportViewProps) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex items-center gap-2 sticky top-14 z-30 py-2 bg-bg/90 backdrop-blur md:static md:bg-transparent md:backdrop-blur-none">
        <button onClick={onStartNew} className="h-8 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border rounded-full flex items-center gap-1.5 transition-colors shadow-sm"><X className="w-3.5 h-3.5" />Start New</button>
        <button onClick={onEditInputs} className="h-8 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border rounded-full flex items-center gap-1.5 transition-colors shadow-sm"><Edit3 className="w-3.5 h-3.5" />Edit Inputs</button>
        <div className="flex-1" />
        <button onClick={onReAnalyze} className="h-8 px-3 text-xs text-text-muted hover:text-text bg-bg-card hover:bg-bg-hover border border-border rounded-full flex items-center gap-1.5 transition-colors shadow-sm"><RefreshCw className="w-3.5 h-3.5" />Re-analyze</button>
      </div>
      {responseSubmission ? <ResponseWorkflowCard submission={responseSubmission} /> : (
        <p role="alert" className="rounded-lg border border-sev2/40 p-4 text-sm">이 보고서에 연결된 입력 스냅샷이 없습니다. 대응 검토를 만들려면 입력을 다시 분석하세요.</p>
      )}
      <ReportCard report={report} enableGrounding={enableGrounding} ttsAvailable={ttsAvailable} />
    </div>
  );
}
