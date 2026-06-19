
import React from 'react';
import { FileText } from 'lucide-react';
import { SAMPLE_PRESETS } from '../constants';
import type { AppState } from '../hooks/useAppState';

interface OperatorDashboardProps {
  state: AppState;
}

export function OperatorDashboard({ state }: OperatorDashboardProps) {
  const {
    runtimePosture,
    reportSchema,
    replayOverview,
    summaryPack,
    architectureRoutes,
    reviewStateChips,
    copyReviewChecklist,
    copyArchitectureRoutes,
    copyEvidenceSnapshot,
    loadStrongestPreset,
    copyStrongestPreset,
    copyIncidentClaim,
    copyReviewStateLink,
    copyArchitectureBundle,
    copyPayloadBudgetSnapshot,
    copyEscalationBrief,
    loadPreset,
  } = state;

  return (
    <div className="rounded-lg border border-border bg-bg-card/90 p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-accent" />
            Operator Dashboard
          </div>
          <p className="text-2xs text-text-muted max-w-2xl">
            입력 전에 runtime posture, architecture flow, fast links, preset repro path를 한 번에 정리합니다.
          </p>
        </div>
        <button
          onClick={copyReviewChecklist}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Architecture Checklist
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={copyArchitectureRoutes}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Architecture Routes
        </button>
        <button
          onClick={copyEvidenceSnapshot}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Evidence Snapshot
        </button>
        <button
          onClick={loadStrongestPreset}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Load Strongest Preset
        </button>
        <button
          onClick={copyStrongestPreset}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Strongest Preset
        </button>
        <button
          onClick={copyIncidentClaim}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Incident Claim
        </button>
        <button
          onClick={copyReviewStateLink}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Architecture Link
        </button>
        <button
          onClick={copyArchitectureBundle}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Export Summary
        </button>
        <button
          onClick={copyPayloadBudgetSnapshot}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Payload Budget
        </button>
        <button
          onClick={copyEscalationBrief}
          className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
        >
          Copy Escalation Brief
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-[10px] px-2 py-1 rounded-full border bg-accent/10 text-accent border-accent/20">
          {runtimePosture}
        </span>
        <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
          Schema {reportSchema?.schemaId ?? 'loading'}
        </span>
        <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
          Replay {replayOverview ? `${replayOverview.summary.passRate}% pass` : 'loading'}
        </span>
        {reviewStateChips.map((chip) => (
          <span key={chip} className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
            {chip}
          </span>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-bg/80 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Architecture flow</div>
          <div className="space-y-2">
            {(summaryPack?.twoMinuteArchitecture?.length ? summaryPack.twoMinuteArchitecture : [
              { step: 'Load summary pack', surface: '/api/summary-pack', proof: 'architecture route unavailable' },
            ]).map((item) => (
              <div key={`${item.step}-${item.surface}`} className="rounded-md border border-border bg-bg-card/70 px-3 py-2">
                <div className="text-xs font-medium text-text">{item.step}</div>
                <div className="text-2xs text-text-muted mt-1">{item.surface}</div>
                <div className="text-2xs text-accent mt-1">{item.proof}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/80 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Fast architecture routes</div>
          <div className="flex flex-wrap gap-2">
            {architectureRoutes.length > 0 ? (
              architectureRoutes.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text inline-flex items-center"
                >
                  Open {label}
                </a>
              ))
            ) : (
              <div className="text-2xs text-text-muted">Architecture routes are still loading.</div>
            )}
          </div>
          <div className="text-2xs text-text-muted">
            Presets stay in the same deck so operators can reproduce a strong run without hunting through the page.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {SAMPLE_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => loadPreset(preset)}
            className="h-7 px-3 text-xs text-text-muted hover:text-text bg-bg hover:bg-bg-hover border border-border hover:border-border-light rounded-full transition-all"
          >
            Load Preset: {preset.name}
          </button>
        ))}
      </div>
    </div>
  );
}
