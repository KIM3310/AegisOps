import type { IncidentReplayCase } from "../types";

export const INCIDENT_REPLAY_CASES: IncidentReplayCase[] = [
  {
    id: "llm-latency-spike",
    title: "LLM Latency Spike",
    description: "SLO breach, queue saturation, memory pressure, and autoscaling recovery.",
    imageCount: 1,
    logs: `[2025-01-15T14:30:00Z] INFO: LLM API response time: 150ms
[2025-01-15T14:30:15Z] WARN: Response time increased: 850ms - approaching SLO threshold
[2025-01-15T14:30:30Z] ERROR: Response time: 3500ms - SLO BREACH DETECTED
[2025-01-15T14:30:45Z] ALERT: Circuit breaker OPEN for llm-service
[2025-01-15T14:31:00Z] ERROR: Request queue depth: 5000 (limit: 1000)
[2025-01-15T14:31:15Z] WARN: Memory pressure detected on inference nodes
[2025-01-15T14:31:30Z] INFO: Auto-scaling triggered: 10 -> 25 replicas
[2025-01-15T14:33:00Z] INFO: New replicas online, load balancing active
[2025-01-15T14:35:00Z] INFO: Circuit breaker CLOSED, latency recovered: 200ms`,
    expected: {
      severity: "SEV1",
      titleIncludes: ["latency", "queue", "backpressure"],
      tagsInclude: ["latency", "queue", "autoscaling", "circuit-breaker", "memory"],
      rootCauseIncludes: ["resource saturation", "queue growth"],
      actionItemsInclude: ["runbook", "load test"],
      reasoningSections: ["Observations", "Hypotheses", "Decision Path"],
      minTimelineEvents: 6,
      confidenceRange: { min: 60, max: 80 },
    },
  },
  {
    id: "redis-oom-failover",
    title: "Redis Cluster Crash",
    description: "Redis master OOM, quorum loss, and cache miss storm during failover.",
    imageCount: 1,
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
    expected: {
      severity: "SEV1",
      titleIncludes: ["redis", "oom", "cache miss"],
      tagsInclude: ["redis", "oom", "memory"],
      rootCauseIncludes: ["memory pressure", "guardrails"],
      actionItemsInclude: ["SEV1", "load test"],
      reasoningSections: ["Observations", "Hypotheses", "Decision Path"],
      minTimelineEvents: 6,
      confidenceRange: { min: 60, max: 80 },
    },
  },
  {
    id: "payments-retry-storm",
    title: "Payments API Retry Storm",
    description: "5xx spike and queue growth caused by client retries after a slow downstream dependency.",
    imageCount: 0,
    logs: `[2025-02-02T03:11:00Z] WARN: Checkout latency rising: 420ms
[2025-02-02T03:11:12Z] ERROR: HTTP 5xx error rate: 7.4%
[2025-02-02T03:11:20Z] WARN: Retry fan-out increased active requests by 3.1x
[2025-02-02T03:11:40Z] ERROR: Request queue depth: 2400
[2025-02-02T03:12:05Z] INFO: Downstream tokenization service saturation suspected
[2025-02-02T03:13:10Z] INFO: Retry budget reduced for non-critical clients
[2025-02-02T03:14:30Z] INFO: Queue depth trending down to 600
[2025-02-02T03:16:00Z] INFO: HTTP 5xx error rate: 1.2%`,
    expected: {
      severity: "SEV2",
      titleIncludes: ["latency", "queue", "backpressure"],
      tagsInclude: ["latency", "queue", "errors"],
      rootCauseIncludes: ["resource saturation", "queue growth"],
      actionItemsInclude: ["runbook", "alert"],
      reasoningSections: ["Observations", "Hypotheses", "Decision Path"],
      minTimelineEvents: 5,
      confidenceRange: { min: 60, max: 80 },
    },
  },
  {
    id: "search-warning-buildup",
    title: "Search Index Lag Warning",
    description: "Warning-only incident with queue buildup and elevated latency, but no hard outage yet.",
    imageCount: 0,
    logs: `[2025-02-15T18:00:00Z] WARN: Search indexing latency increased to 180ms
[2025-02-15T18:00:20Z] WARN: Queue depth: 320
[2025-02-15T18:01:00Z] WARN: Queue depth: 540
[2025-02-15T18:01:30Z] WARN: Autoscaling pending capacity in indexing workers
[2025-02-15T18:02:20Z] INFO: Additional workers requested
[2025-02-15T18:04:00Z] INFO: Index freshness recovered`,
    expected: {
      severity: "SEV3",
      titleIncludes: ["latency", "queue", "backpressure"],
      tagsInclude: ["latency", "queue", "autoscaling"],
      rootCauseIncludes: ["resource saturation", "queue growth"],
      actionItemsInclude: ["runbook", "load test"],
      reasoningSections: ["Observations", "Hypotheses", "Decision Path"],
      minTimelineEvents: 4,
      confidenceRange: { min: 60, max: 80 },
    },
  },
];
