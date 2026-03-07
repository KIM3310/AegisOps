import React from 'react';
import { Activity, RefreshCw, ShieldCheck, Siren, Target } from 'lucide-react';
import type { ReplayEvalOverview } from '../types';

interface Props {
  overview: ReplayEvalOverview | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export const ReplayEvalCard: React.FC<Props> = ({ overview, loading, error, onRefresh }) => {
  const dominantBucket = overview?.buckets[0];

  return (
    <section className="rounded-xl border border-border bg-bg-card/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-accent" />
            Incident Replay Suite
          </div>
          <p className="text-2xs text-text-muted mt-1 max-w-2xl leading-relaxed">
            Included replay cases scored against a fixed rubric for severity, coverage, and actionability.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="h-8 px-2.5 text-xs text-text-muted hover:text-text hover:bg-bg-hover rounded-md flex items-center gap-1.5 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-sev1/20 bg-sev1/5 px-3 py-2 text-2xs text-sev1">
          Replay evals unavailable: {error}
        </div>
      )}

      {!error && !overview && loading && (
        <div className="mt-4 rounded-lg border border-border bg-bg px-3 py-4 text-2xs text-text-muted">
          Loading replay summary...
        </div>
      )}

      {overview && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-bg px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim flex items-center gap-1.5">
                <Target className="w-3 h-3" />
                Pass Rate
              </div>
              <div className="mt-2 text-lg font-semibold text-text">{overview.summary.passRate}%</div>
              <div className="text-2xs text-text-muted">
                {overview.summary.passedChecks}/{overview.summary.totalChecks} rubric checks
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim flex items-center gap-1.5">
                <Siren className="w-3 h-3" />
                Severity Accuracy
              </div>
              <div className="mt-2 text-lg font-semibold text-text">{overview.summary.severityAccuracy}%</div>
              <div className="text-2xs text-text-muted">
                {overview.summary.casesPassingAll}/{overview.summary.totalCases} cases fully green
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                Dominant Gap
              </div>
              <div className="mt-2 text-sm font-semibold text-text">
                {dominantBucket ? dominantBucket.category.replace(/_/g, ' ') : 'no open replay gaps'}
              </div>
              <div className="text-2xs text-text-muted">
                {dominantBucket ? `${dominantBucket.failures} failed check(s)` : 'All replay checks passed'}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            {overview.cases.map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-bg px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-text">{item.title}</div>
                    <div className="text-2xs text-text-muted mt-0.5">
                      observed {item.observed.severity} · {item.passRate}% · {item.observed.timelineEvents} timeline events
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full border ${
                      item.status === 'pass'
                        ? 'bg-sev3/10 text-sev3 border-sev3/20'
                        : 'bg-sev1/10 text-sev1 border-sev1/20'
                    }`}
                  >
                    {item.status === 'pass' ? 'PASS' : 'GAP'}
                  </span>
                </div>
                <div className="mt-2 text-2xs text-text-muted">
                  {item.failedChecks.length > 0
                    ? item.failedChecks.map((check) => check.category.replace(/_/g, ' ')).join(', ')
                    : item.observed.tags.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
