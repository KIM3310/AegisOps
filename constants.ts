
export interface ImageFile {
  file: File;
  preview: string;
}

export interface ApiImageInput {
  mimeType: string;
  data: string;
}

export const DEMO_IMG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAALUlEQVR42u3RAQ0AAAgDIJ/6N5WCB9R0oJ1O1+l0nU7X6XSdTtfpdJ1O1+l0XfsAE12D4Z5+1R4AAAAASUVORK5CYII=";

export const SAMPLE_PRESETS = [
  {
    name: 'LLM Latency Spike',
    logs: `[2025-01-15T14:30:00Z] INFO: LLM API response time: 150ms
[2025-01-15T14:30:15Z] WARN: Response time increased: 850ms - approaching SLO threshold
[2025-01-15T14:30:30Z] ERROR: Response time: 3500ms - SLO BREACH DETECTED
[2025-01-15T14:30:45Z] ALERT: Circuit breaker OPEN for llm-service
[2025-01-15T14:31:00Z] ERROR: Request queue depth: 5000 (limit: 1000)
[2025-01-15T14:31:15Z] WARN: Memory pressure detected on inference nodes
[2025-01-15T14:31:30Z] INFO: Auto-scaling triggered: 10 -> 25 replicas
[2025-01-15T14:33:00Z] INFO: New replicas online, load balancing active
[2025-01-15T14:35:00Z] INFO: Circuit breaker CLOSED, latency recovered: 200ms`,
    hasImage: true
  },
  {
    name: 'Redis Cluster Crash',
    logs: `[2025-01-15T09:15:00Z] WARN: Redis node redis-master-01 memory usage: 92%
[2025-01-15T09:17:00Z] WARN: Memory usage critical: 98%
[2025-01-15T09:18:00Z] ERROR: Redis node redis-master-01 OOM killed by kernel
[2025-01-15T09:18:05Z] ALERT: Cluster state changed to FAIL - quorum lost
[2025-01-15T09:18:10Z] ERROR: Cache miss rate: 100%
[2025-01-15T09:18:15Z] ERROR: Database connection pool exhausted
[2025-01-15T09:18:30Z] INFO: Automatic failover initiated
[2025-01-15T09:20:00Z] INFO: redis-replica-02 promoted to master
[2025-01-15T09:22:00Z] INFO: Cluster failover complete
[2025-01-15T09:25:00Z] INFO: Cache hit rate recovered: 94%`,
    hasImage: true
  },
];

export const REVIEW_LENSES = {
  quickstart: {
    label: 'Quick Start',
    eyebrow: 'Quick start lens',
    headline: 'Show the strongest evidence path without digging through code.',
    description:
      'Lead with the strongest preset, confirm replay quality, then close with a compact export summary.',
    cards: [
      ['01 \u00b7 Strongest preset', 'Start from a representative incident so the walkthrough lands fast.'],
      ['02 \u00b7 Replay proof', 'Use pass rate and severity accuracy before talking about provider quality.'],
      ['03 \u00b7 Export summary', 'Send one compact handoff instead of narrating every panel live.'],
    ],
    actions: [
      { label: 'Load Strongest Preset', type: 'load-preset' },
      { label: 'Copy Review Checklist', type: 'checklist' },
      { label: 'Copy Export Summary', type: 'bundle' },
    ],
  },
  commander: {
    label: 'Commander',
    eyebrow: 'Incident commander lens',
    headline: 'Keep escalation, provider posture, and replay evidence in one deck.',
    description:
      'Use this lens when the audience cares about escalation quality, provider tradeoffs, and the next operator move.',
    cards: [
      ['01 \u00b7 Incident claim', 'Summarize the current incident with severity, bucket, and replay posture.'],
      ['02 \u00b7 Provider tradeoff', 'Compare static demo, backend runtime, and provider options before escalating.'],
      ['03 \u00b7 Escalation brief', 'End with a copyable brief that already contains the fast routes.'],
    ],
    actions: [
      { label: 'Copy Incident Claim', type: 'claim' },
      { label: 'Copy Escalation Brief', type: 'escalation' },
      { label: 'Copy Review Routes', type: 'routes' },
    ],
  },
  platform: {
    label: 'Platform',
    eyebrow: 'Platform lens',
    headline: 'Frame the service as an operator-safe incident system, not just a demo.',
    description:
      'Use this path when evaluating about runtime posture, payload limits, and how the service scales beyond the preset.',
    cards: [
      ['01 \u00b7 Runtime posture', 'Anchor the conversation in deployment mode, provider state, and schema contract.'],
      ['02 \u00b7 Payload budget', 'Show where logs and screenshots hit the safety limits before live runtime claims.'],
      ['03 \u00b7 Review link', 'Keep a shareable state link so the same evidence path can be replayed later.'],
    ],
    actions: [
      { label: 'Copy Payload Budget', type: 'payload' },
      { label: 'Copy Review Link', type: 'link' },
      { label: 'Copy Review Routes', type: 'routes' },
    ],
  },
} as const;

export type ReviewLensKey = keyof typeof REVIEW_LENSES;
export type SamplePreset = (typeof SAMPLE_PRESETS)[number];
