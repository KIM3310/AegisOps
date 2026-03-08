import React from "react";
import { ExternalLink, FileText, Gauge, ListChecks, Shield } from "lucide-react";
import type { ReviewPackResponse } from "../services/geminiService";

interface Props {
  reviewPack: ReviewPackResponse | null;
}

function isExternalLink(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export const ReviewPackCard: React.FC<Props> = ({ reviewPack }) => {
  if (!reviewPack) {
    return null;
  }

  const reviewLinks = [
    { label: "Demo", href: reviewPack.links.demo },
    { label: "Video", href: reviewPack.links.video },
    { label: "README", href: reviewPack.links.readme },
  ];
  const apiSurfaces = [
    reviewPack.links.healthz,
    reviewPack.links.reviewPack,
    reviewPack.links.replayEvals,
    reviewPack.links.reportSchema,
  ];

  return (
    <section className="rounded-xl border border-border bg-bg-card/90 p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-text">
            <FileText className="w-4 h-4 text-accent" />
            Executive Review Pack
          </div>
          <div className="mt-2 text-sm font-medium text-text max-w-2xl">
            {reviewPack.headline}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded-full border border-border bg-bg">
            {reviewPack.reviewPackId}
          </span>
          <span className="px-2 py-1 rounded-full border border-border bg-bg">
            {reviewPack.deployment === "static-demo" ? "STATIC DEMO" : "BACKEND"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {reviewPack.operatorJourney.map((item) => (
          <div key={item.stage} className="rounded-lg border border-border bg-bg/70 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim">{item.stage}</div>
            <div className="mt-2 text-sm font-medium text-text">{item.summary}</div>
            <div className="mt-2 text-2xs text-text-muted">{item.surface}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr_1fr]">
        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            <Gauge className="w-3.5 h-3.5" />
            Proof Bundle
          </div>
          <div className="mt-2 text-2xs text-text-muted leading-relaxed">
            Replay pass: <span className="text-text">{reviewPack.proofBundle.replayPassRate.toFixed(0)}%</span>
            <br />
            Severity accuracy: <span className="text-text">{reviewPack.proofBundle.severityAccuracy.toFixed(0)}%</span>
            <br />
            Rubric checks: <span className="text-text">{reviewPack.proofBundle.totalChecks}</span>
          </div>
          <div className="mt-3 text-2xs text-text-muted">
            Runtime modes: <span className="text-text">{reviewPack.proofBundle.runtimeModes.join(", ")}</span>
          </div>
          <div className="mt-2 text-2xs text-text-muted">
            Exports: <span className="text-text">{reviewPack.proofBundle.exportFormats.join(", ")}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            <Shield className="w-3.5 h-3.5" />
            Trust Boundary
          </div>
          <div className="mt-2 space-y-2 text-2xs text-text-muted leading-relaxed">
            {reviewPack.trustBoundary.map((item) => (
              <div key={item}>- {item}</div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/70 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-dim">
            <ListChecks className="w-3.5 h-3.5" />
            Review Sequence
          </div>
          <div className="mt-2 space-y-2 text-2xs text-text-muted leading-relaxed">
            {reviewPack.reviewSequence.map((item) => (
              <div key={item}>- {item}</div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {reviewPack.proofBundle.requiredFields.slice(0, 6).map((field) => (
              <span key={field} className="px-2 py-1 rounded-full border border-border bg-bg text-[10px] text-text-muted">
                {field}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {apiSurfaces.map((surface) => (
          <span
            key={surface}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-bg text-xs text-text-muted"
          >
            {surface}
          </span>
        ))}
        {reviewLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target={isExternalLink(link.href) ? "_blank" : undefined}
            rel={isExternalLink(link.href) ? "noreferrer" : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-bg hover:bg-bg-hover text-xs text-text-muted hover:text-text transition-colors"
          >
            {link.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        ))}
      </div>
    </section>
  );
};
