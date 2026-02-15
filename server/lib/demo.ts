import type { IncidentReport, IncidentSeverity, TimelineEvent, ActionItem } from "../../types";

function clampText(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 20))}\n\n...[truncated ${t.length - max} chars]`;
}

function guessSeverity(logs: string): IncidentSeverity {
  const s = logs.toLowerCase();
  if (s.includes("sev1")) return "SEV1";
  if (s.includes("slo breach") || s.includes("circuit breaker open") || s.includes("quorum lost") || s.includes("fail")) return "SEV1";
  if (s.includes("error")) return "SEV2";
  if (s.includes("warn")) return "SEV3";
  return "UNKNOWN";
}

function extractTimeline(logs: string, limit = 8): TimelineEvent[] {
  const lines = (logs || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const events: TimelineEvent[] = [];
  const tsRe = /^\[([^\]]+)\]\s*(INFO|WARN|ERROR|ALERT)?:?\s*(.*)$/i;

  for (const line of lines) {
    const m = line.match(tsRe);
    if (!m) continue;
    const level = (m[2] || "INFO").toUpperCase();
    const severity = level === "ALERT" || level === "ERROR" ? "critical" : level === "WARN" ? "warning" : "info";
    events.push({
      time: m[1].slice(-8), // best-effort "HH:mm:ss" like display
      description: m[3] || line,
      severity,
    });
    if (events.length >= limit) break;
  }

  return events;
}

function deriveTags(logs: string): string[] {
  const s = logs.toLowerCase();
  const tags = new Set<string>();
  if (s.includes("redis")) tags.add("redis");
  if (s.includes("oom") || s.includes("out of memory")) tags.add("oom");
  if (s.includes("latency")) tags.add("latency");
  if (s.includes("error rate") || s.includes("5xx")) tags.add("errors");
  if (s.includes("circuit breaker")) tags.add("circuit-breaker");
  if (s.includes("autoscaling") || s.includes("auto-scaling")) tags.add("autoscaling");
  if (s.includes("queue")) tags.add("queue");
  if (s.includes("memory")) tags.add("memory");
  return Array.from(tags).slice(0, 8);
}

function buildActionItems(sev: IncidentSeverity): ActionItem[] {
  const base: ActionItem[] = [
    { task: "Add a runbook section for fast triage (symptom -> likely causes -> safe mitigations).", owner: "SRE", priority: "HIGH" },
    { task: "Create an SLO burn-rate alert and a latency/error budget dashboard snapshot for incident comms.", owner: "Observability", priority: "MEDIUM" },
    { task: "Add a regression guard (load test + alert replay) to catch recurrence before rollout.", owner: "Platform", priority: "MEDIUM" },
  ];
  if (sev === "SEV1") {
    base.unshift({ task: "Define an on-call escalation checklist and stakeholder update cadence for SEV1.", owner: "Incident Commander", priority: "HIGH" });
    return base.slice(0, 4);
  }
  return base.slice(0, 3);
}

export function demoAnalyzeIncident(input: { logs: string; imageCount: number; maxLogChars: number }): IncidentReport {
  const logs = clampText(input.logs, input.maxLogChars);
  const sev = guessSeverity(logs);
  const tags = deriveTags(logs);
  const timeline = extractTimeline(logs);

  const title =
    tags.includes("redis") && tags.includes("oom")
      ? "Redis master OOM -> cache miss storm and downstream saturation"
      : tags.includes("latency") && tags.includes("queue")
        ? "Latency spike driven by request queue saturation and backpressure"
        : "Service degradation requiring investigation";

  const summary =
    sev === "SEV1"
      ? "High-severity degradation with clear signals in logs. Immediate mitigation focused on stabilizing traffic and restoring capacity."
      : "Incident signals detected from logs/screenshots. This report summarizes the most likely causes and next actions based on available evidence.";

  const reasoning = [
    "**Observations**",
    `- Received ${input.imageCount} monitoring screenshot(s) (demo mode: images are not parsed).`,
    ...timeline.slice(0, 4).map((t) => `- ${t.time}: ${t.description}`),
    "",
    "**Hypotheses**",
    tags.includes("oom") ? "- Memory pressure / OOM kill cascaded into availability issues." : "- Capacity/traffic mismatch increased latency and errors.",
    tags.includes("queue") ? "- Queue depth growth indicates backpressure and saturation." : "- Client retries may have amplified load.",
    "",
    "**Decision Path**",
    "- Prioritize containment: reduce load, shed non-critical traffic, and restore healthy capacity.",
    "- Validate root cause with targeted checks (node memory, GC, cache hit rate, recent config/deploy diffs).",
    "- Capture evidence and open follow-up tasks to prevent recurrence.",
  ].join("\n");

  return {
    title,
    summary,
    severity: sev,
    rootCauses: [
      tags.includes("oom") ? "Memory pressure leading to OOM kill / process restarts" : "Resource saturation under load",
      tags.includes("queue") ? "Backpressure and queue growth during peak traffic" : "Insufficient autoscaling / guardrails",
    ].filter(Boolean),
    reasoning,
    confidenceScore: 68,
    timeline,
    actionItems: buildActionItems(sev),
    mitigationSteps: [
      "Stabilize traffic via rate limiting / circuit breaker tuning (if applicable).",
      "Scale out critical components and verify health checks before re-enabling full traffic.",
    ],
    impact: {
      estimatedUsersAffected: sev === "SEV1" ? "Significant (estimate required)" : "Unknown",
      duration: "Unknown (needs incident window)",
      peakLatency: tags.includes("latency") ? "Observed in logs (exact value TBD)" : "N/A",
      peakErrorRate: tags.includes("errors") ? "Observed in logs (exact value TBD)" : "N/A",
    },
    tags,
    lessonsLearned: "Even with abundant telemetry, the bottleneck is consolidating evidence into a decision-ready narrative.",
    preventionRecommendations: [
      "Add capacity tests for peak scenarios and validate autoscaling thresholds.",
      "Add memory/circuit-breaker guardrails and standardize runbook escalation steps.",
    ],
    references: [],
  };
}

export function demoFollowUpAnswer(input: { report: IncidentReport; question: string }): string {
  const q = (input.question || "").trim();
  if (!q) return "Ask a question about this incident.";

  return [
    "Demo mode response (no external LLM calls).",
    "",
    `Question: ${q}`,
    "",
    "Suggested next steps:",
    "- Clarify the incident window (start/end) and confirm top KPIs (latency, error rate, queue depth).",
    "- Identify the most probable failure domain (resource, dependency, config/deploy, traffic shift).",
    "- Add 1-2 concrete prevention items tied to measurable guardrails (SLO alerts, load tests, rollback criteria).",
  ].join("\n");
}

