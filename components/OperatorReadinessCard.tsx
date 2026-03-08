import React from "react";
import { AlertTriangle, CheckCircle2, Gauge, Globe, ListChecks, Shield, Sparkles } from "lucide-react";
import type { ReplayEvalOverview } from "../types";
import type { ApiKeySource, HealthzResponse, ReportSchemaResponse, ServiceMetaResponse } from "../services/geminiService";

interface Props {
  health: HealthzResponse | null;
  meta: ServiceMetaResponse | null;
  schema: ReportSchemaResponse | null;
  replayOverview: ReplayEvalOverview | null;
  replayLoading: boolean;
  replayError: string | null;
  logs: string;
  imageCount: number;
  enableGrounding: boolean;
  enableTmVision: boolean;
  tmConfigured: boolean;
  tmStatus: "IDLE" | "RUNNING" | "READY" | "ERROR";
  apiKeySource: ApiKeySource;
  onRefreshReplay: () => void;
}

function buildWarnings(props: Props): string[] {
  const warnings: string[] = [];
  const limits = props.health?.limits;
  const maxImages = limits?.maxImages ?? props.schema?.inputLimits.maxImages ?? 16;
  const maxLogChars = limits?.maxLogChars ?? props.schema?.inputLimits.maxLogChars ?? 50_000;

  if (!props.logs.trim() && props.imageCount === 0) {
    warnings.push("No incident evidence loaded yet. Add logs, screenshots, or a preset before analysis.");
  }
  if (props.logs.length >= Math.floor(maxLogChars * 0.9)) {
    warnings.push(`Logs are near the truncation guardrail (${props.logs.length}/${maxLogChars} chars).`);
  }
  if (props.imageCount > maxImages) {
    warnings.push(`Only the first ${maxImages} screenshots will be analyzed due to payload guardrails.`);
  }
  if (props.health?.deployment === "static-demo") {
    warnings.push("Static demo is active. Backend-only features such as live Gemini BYOK remain unavailable.");
  } else if (props.health?.mode === "demo") {
    warnings.push("Backend is running in demo mode. Add a Gemini key or switch to Ollama for live analysis.");
  }
  if (props.enableGrounding && props.health?.deployment === "static-demo") {
    warnings.push("Grounding is toggled on, but static demo mode does not fetch live web sources.");
  }
  if (props.enableTmVision && !props.tmConfigured) {
    warnings.push("TM Vision is enabled in the UI, but no Teachable Machine model is configured.");
  }
  if (props.apiKeySource === "runtime") {
    warnings.push("A runtime Gemini key override is active. This resets on backend restart.");
  }
  return warnings;
}

export const OperatorReadinessCard: React.FC<Props> = (props) => {
  const limits = props.health?.limits ?? props.schema?.inputLimits;
  const warnings = buildWarnings(props);
  const replayPassRate = props.replayOverview?.summary.passRate ?? props.meta?.replaySuite.passRate ?? 0;
  const severityAccuracy = props.replayOverview?.summary.severityAccuracy ?? props.meta?.replaySuite.severityAccuracy ?? 0;

  return (
    <section className="rounded-xl border border-border bg-bg-card/90 p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-text">
            <Shield className="w-4 h-4 text-accent" />
            Operator Readiness
          </div>
          <p className="mt-1 text-2xs text-text-muted leading-relaxed">
            Review deployment posture, replay quality, input guardrails, and report contract before running analysis.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded-full border border-border bg-bg">
            {props.health?.deployment === "static-demo" ? "STATIC DEMO" : props.health?.mode === "live" ? "LIVE BACKEND" : "DEMO BACKEND"}
          </span>
          <span className="px-2 py-1 rounded-full border border-border bg-bg">
            {props.health?.provider?.toUpperCase() || "UNKNOWN"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Runtime</div>
          <div className="mt-2 text-sm font-medium text-text">{props.meta?.product.headline || "Multimodal incident copilot"}</div>
          <div className="mt-2 text-2xs text-text-muted leading-relaxed">
            Model: <span className="text-text">{props.health?.models?.analyze || props.meta?.models.analyze || "Unknown"}</span>
            <br />
            TTS: <span className="text-text">{props.health?.models?.tts || props.meta?.models.tts || "Unknown"}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            <Gauge className="w-3.5 h-3.5" />
            Replay Quality
          </div>
          <div className="mt-2 text-lg font-semibold text-text">{replayPassRate.toFixed(0)}% pass</div>
          <div className="text-2xs text-text-muted mt-1">
            Severity accuracy {severityAccuracy.toFixed(0)}%
            <br />
            {props.replayLoading ? "Loading replay telemetry..." : `${props.replayOverview?.summary.totalChecks ?? props.meta?.replaySuite.totalChecks ?? 0} rubric checks`}
          </div>
          <button
            onClick={props.onRefreshReplay}
            className="mt-3 h-7 px-2.5 rounded-md border border-border bg-bg hover:bg-bg-hover text-[11px] text-text-muted hover:text-text transition-colors"
          >
            Refresh Replay
          </button>
        </div>

        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            <Sparkles className="w-3.5 h-3.5" />
            Input Contract
          </div>
          <div className="mt-2 text-2xs text-text-muted leading-relaxed">
            Logs: <span className="text-text">{props.logs.length}</span> / {limits?.maxLogChars ?? "?"} chars
            <br />
            Screenshots: <span className="text-text">{props.imageCount}</span> / {limits?.maxImages ?? "?"}
            <br />
            Grounding: <span className="text-text">{props.enableGrounding ? "ON" : "OFF"}</span>
            <br />
            TM Vision: <span className="text-text">{props.enableTmVision ? props.tmStatus : "OFF"}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            <ListChecks className="w-3.5 h-3.5" />
            Report Contract
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(props.schema?.requiredFields || props.meta?.reportContract.requiredFields || []).map((field) => (
              <span key={field} className="px-2 py-1 rounded-full border border-border bg-bg text-[10px] text-text-muted">
                {field}
              </span>
            ))}
          </div>
          <div className="mt-3 text-2xs text-text-muted leading-relaxed">
            Export surfaces: {(props.schema?.exportFormats || props.meta?.reportContract.exportFormats || []).join(", ")}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            {warnings.length > 0 ? <AlertTriangle className="w-3.5 h-3.5 text-sev2" /> : <CheckCircle2 className="w-3.5 h-3.5 text-sev3" />}
            Preflight
          </div>
          <div className="mt-2 space-y-2 text-2xs leading-relaxed">
            {warnings.length > 0 ? (
              warnings.slice(0, 4).map((warning) => (
                <div key={warning} className="text-text-muted">
                  - {warning}
                </div>
              ))
            ) : (
              <div className="text-text-muted">Ready to analyze. Current inputs fit within the default service guardrails.</div>
            )}
            {props.replayError && <div className="text-sev1">Replay telemetry error: {props.replayError}</div>}
            <div className="pt-1 text-text-dim">
              <Globe className="inline-block w-3 h-3 mr-1" />
              Grounding should be treated as external hinting, not source of truth.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
