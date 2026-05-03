
import React from 'react';
import { Shield, Sparkles } from 'lucide-react';
import { REVIEW_LENSES } from '../constants';
import type { AppState } from '../hooks/useAppState';

interface FrontDoorSectionProps {
  state: AppState;
}

export function FrontDoorSection({ state }: FrontDoorSectionProps) {
  const {
    runtimePosture,
    proofSummary,
    reportSchema,
    strongestPreset,
    providerNarrative,
    runtimeEvidenceNote,
    reviewLensNextAction,
    reviewLensNextStep,
    frontDoorDecisionSupport,
    loadStrongestPreset,
    copyReviewChecklist,
    copyReviewRoutes,
    reviewLens,
    setReviewLens,
    activeReviewLens,
    runReviewLensAction,
  } = state;

  return (
    <section className="rounded-2xl border border-border bg-bg-card/95 p-5 sm:p-6 shadow-sm space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.22em] text-accent">Incident theater front door</div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              Walk a believable incident before you talk about runtime.
              <Sparkles className="w-4 h-4 text-accent animate-pulse" />
            </h1>
            <p className="text-sm text-text-muted max-w-2xl leading-6">
              Start with a replay-backed incident claim, show exactly what is proven in this build, then use provider posture and escalation tools to guide the next conversation.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] px-2 py-1 rounded-full border bg-accent/10 text-accent border-accent/20">
              {runtimePosture}
            </span>
            <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
              {proofSummary}
            </span>
            <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
              Schema {reportSchema?.schemaId ?? 'loading'}
            </span>
            {strongestPreset && (
              <span className="text-[10px] px-2 py-1 rounded-full border bg-bg text-text-dim border-border">
                First click {strongestPreset.name}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-border bg-bg/80 px-4 py-3 space-y-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">What this front door proves</div>
            <p className="text-sm text-text font-medium">{providerNarrative}</p>
            <p className="text-2xs text-text-muted leading-5">{runtimeEvidenceNote}</p>
          </div>

          <div className="rounded-xl border border-border bg-bg/80 px-4 py-3 space-y-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Right now</div>
            <p className="text-sm text-text font-medium">{reviewLensNextAction?.label ?? 'Load Strongest Preset'}</p>
            <p className="text-2xs text-text-muted leading-5">
              {reviewLensNextStep?.[1] ?? 'Start from one concrete incident so the walkthrough lands before provider discussion branches.'}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-bg/80 px-4 py-3 space-y-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Decision support</div>
            <p className="text-2xs text-text-muted leading-5">Go now &middot; {frontDoorDecisionSupport.goNow}</p>
            <p className="text-2xs text-text-muted leading-5">Hold line &middot; {frontDoorDecisionSupport.holdLine}</p>
            <p className="text-2xs text-text-muted leading-5">Exit with &middot; {frontDoorDecisionSupport.exitWith}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadStrongestPreset}
              className="h-9 px-4 rounded-md border border-accent/30 bg-accent/10 hover:bg-accent/15 text-sm font-medium text-accent"
            >
              Load Strongest Preset
            </button>
            <button
              onClick={copyReviewChecklist}
              className="h-9 px-4 rounded-md border border-border bg-bg hover:bg-bg-hover text-sm text-text-muted hover:text-text"
            >
              Copy Review Checklist
            </button>
            <button
              onClick={copyReviewRoutes}
              className="h-9 px-4 rounded-md border border-border bg-bg hover:bg-bg-hover text-sm text-text-muted hover:text-text"
            >
              Copy Review Routes
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg/80 p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">First review pass</div>
          <div className="space-y-2">
            <article className="rounded-lg border border-border bg-bg-card/70 px-3 py-3">
              <div className="text-xs font-semibold text-text">01 &middot; Land the incident story</div>
              <p className="text-2xs text-text-muted mt-2 leading-5">
                Load {strongestPreset?.name ?? 'the strongest preset'} so the first click opens on a concrete failure, screenshot, and operator-safe summary.
              </p>
            </article>
            <article className="rounded-lg border border-border bg-bg-card/70 px-3 py-3">
              <div className="text-xs font-semibold text-text">02 &middot; Separate proof from provider posture</div>
              <p className="text-2xs text-text-muted mt-2 leading-5">
                Use replay pass rate and severity accuracy as the proof lane, then use provider comparison to explain deployment tradeoffs without implying live measurements.
              </p>
            </article>
            <article className="rounded-lg border border-border bg-bg-card/70 px-3 py-3">
              <div className="text-xs font-semibold text-text">03 &middot; Exit with the right handoff</div>
              <p className="text-2xs text-text-muted mt-2 leading-5">
                Choose the {REVIEW_LENSES[reviewLens].label.toLowerCase()} framing, then end with a checklist, bundle, or escalation brief instead of narrating every panel live.
              </p>
            </article>
          </div>
        </div>
      </div>

      <div className="border-t border-border/80 pt-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-accent" />
              Operator proof framing
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {Object.entries(REVIEW_LENSES).map(([key, lens]) => (
                <button
                  key={key}
                  onClick={() => setReviewLens(key as 'quickstart' | 'commander' | 'platform')}
                  className={`h-7 px-3 rounded-full border text-[11px] font-semibold transition-colors ${
                    reviewLens === key
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border bg-bg text-text-dim hover:text-text hover:bg-bg-hover'
                  }`}
                >
                  {lens.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-accent">{activeReviewLens.eyebrow}</p>
            <p className="text-sm text-text max-w-2xl font-medium">{activeReviewLens.headline}</p>
            <p className="text-2xs text-text-muted max-w-2xl">
              {activeReviewLens.description}
            </p>
            <div className="rounded-lg border border-border bg-bg/80 px-3 py-3 max-w-xl">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">Right now</div>
              <div className="text-xs font-semibold text-text mt-2">{reviewLensNextAction.label}</div>
              <p className="text-2xs text-text-muted mt-2 leading-5">
                {reviewLensNextStep[1]}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeReviewLens.actions.map((action) => (
              <button
                key={`${reviewLens}-${action.label}`}
                onClick={() => void runReviewLensAction(action.type)}
                className="h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {activeReviewLens.cards.map(([title, body]) => (
            <article key={`${reviewLens}-${title}`} className="rounded-lg border border-border bg-bg/80 px-3 py-3">
              <div className="text-xs font-semibold text-text">{title}</div>
              <p className="text-2xs text-text-muted mt-2 leading-5">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
