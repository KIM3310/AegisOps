import React from "react";
import { Coins, Gauge, RadioTower, ShieldCheck } from "lucide-react";
import type { ProviderComparisonResponse } from "../services/geminiService";

interface Props {
  comparison: ProviderComparisonResponse | null;
  loading: boolean;
  error: string | null;
}

export const ProviderComparisonCard: React.FC<Props> = ({
  comparison,
  loading,
  error,
}) => {
  return (
    <section className="rounded-xl border border-border bg-bg-card/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <RadioTower className="w-3.5 h-3.5 text-accent" />
            Provider Posture
          </div>
          <p className="text-2xs text-text-muted mt-1 max-w-2xl leading-relaxed">
            Use replay evidence first, then compare demo, Gemini, and Ollama tradeoffs without overselling this page as a live runtime benchmark.
          </p>
        </div>
        {comparison && (
          <div className="text-[10px] px-2 py-1 rounded-full border border-border bg-bg text-text-dim">
            Current {comparison.summary.currentProvider.toUpperCase()}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-sev1/20 bg-sev1/5 px-3 py-2 text-2xs text-sev1">
          Provider comparison unavailable: {error}
        </div>
      )}

      {!error && loading && (
        <div className="mt-4 rounded-lg border border-border bg-bg px-3 py-4 text-2xs text-text-muted">
          Loading provider tradeoff view...
        </div>
      )}

      {comparison && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-border bg-bg px-3 py-3 text-2xs text-text-muted">
            <div className="text-xs text-text font-medium">{comparison.summary.headline}</div>
            <div className="mt-2 text-2xs text-text-muted leading-5">
              Treat the latency, quality, and cost bands below as directional operating posture. They are not per-session live measurements from the current page load.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded-full border border-border bg-bg-card/70">
                Replay baseline {comparison.summary.replayBaselinePassRate}% pass
              </span>
              <span className="px-2 py-1 rounded-full border border-border bg-bg-card/70">
                Severity accuracy {comparison.summary.replaySeverityAccuracy}%
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {comparison.providers.map((provider) => (
              <article
                key={provider.id}
                className={`rounded-lg border p-3 space-y-3 ${
                  provider.isCurrent
                    ? "border-accent/40 bg-accent/5"
                    : "border-border bg-bg"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-text">{provider.label}</div>
                    <div className="text-2xs text-text-muted mt-1">
                      {provider.capabilitySummary}
                    </div>
                  </div>
                  {provider.isCurrent && (
                    <span className="text-[10px] px-2 py-1 rounded-full border border-accent/30 bg-accent/10 text-accent">
                      current
                    </span>
                  )}
                </div>

                <div className="grid gap-2 text-2xs text-text-muted">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-3.5 h-3.5 text-text-dim" />
                    <span>Latency: <span className="text-text">{provider.latencyBand}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Coins className="w-3.5 h-3.5 text-text-dim" />
                    <span>Cost: <span className="text-text">{provider.costBand}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-text-dim" />
                    <span>{provider.qualitySignal}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim">Best for</div>
                    <div className="mt-1 text-2xs text-text-muted">
                      {provider.bestFor.join(" · ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim">Tradeoffs</div>
                    <div className="mt-1 text-2xs text-text-muted">
                      {provider.tradeoffs.join(" · ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim">Delta vs static demo</div>
                    <div className="mt-1 text-2xs text-text-muted">
                      {provider.comparison.qualityDelta}
                      <br />
                      {provider.comparison.latencyDelta}
                      <br />
                      {provider.comparison.costDelta}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
