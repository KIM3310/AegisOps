const INCIDENT_BUNDLES = [
  {
    bundleId: "checkout-latency-burst",
    severity: "SEV1",
    lane: "incident-command",
    logSample: "samples/logs/llm_latency_spike.txt",
    screenshotSample: "samples/screenshots/latency_dashboard.png",
    focus:
      "Show how queue depth, latency, and retry spikes become one reviewed incident story.",
  },
  {
    bundleId: "redis-cache-collapse",
    severity: "SEV2",
    lane: "review",
    logSample: "samples/logs/redis_cluster_crash.txt",
    screenshotSample: "samples/screenshots/redis_dashboard.png",
    focus:
      "Demonstrate cache-failure evidence, degraded fallback behavior, and operator handoff wording.",
  },
  {
    bundleId: "billing-retry-stall",
    severity: "SEV2",
    lane: "commander-handoff",
    logSample: "samples/logs/llm_latency_spike.txt",
    screenshotSample: "samples/screenshots/latency_dashboard.png",
    focus:
      "Keep customer-visible billing degradation bounded while showing what a commander needs next.",
  },
  {
    bundleId: "search-read-path-flap",
    severity: "SEV3",
    lane: "training",
    logSample: "samples/logs/redis_cluster_crash.txt",
    screenshotSample: "samples/screenshots/redis_dashboard.png",
    focus:
      "Use a lower-severity event to explain replay scoring, schema guidance, and postmortem structure.",
  },
] as const;

const EVIDENCE_ANNOTATIONS = [
  {
    annotationId: "latency-p95",
    source: "latency_dashboard.png",
    kind: "metric",
    annotation:
      "P95 latency crosses 4s while queue depth grows and success rate decays.",
  },
  {
    annotationId: "retry-burst",
    source: "llm_latency_spike.txt",
    kind: "log",
    annotation:
      "Repeated timeout and retry messages suggest worker exhaustion rather than one bad request.",
  },
  {
    annotationId: "redis-cluster-loss",
    source: "redis_dashboard.png",
    kind: "metric",
    annotation:
      "Replica loss and write amplification point to cache availability as the first suspected failure domain.",
  },
  {
    annotationId: "cache-fallback",
    source: "redis_cluster_crash.txt",
    kind: "log",
    annotation:
      "Fallback cache misses keep traffic moving but increase downstream database pressure.",
  },
] as const;

const OPERATOR_CHECKS = [
  {
    checkId: "confirm-runtime-mode",
    surface: "/api/healthz",
    whyItMatters:
      "Operators should confirm demo, local, or live mode before trusting provider-dependent behavior.",
  },
  {
    checkId: "inspect-scorecard",
    surface: "/api/runtime/scorecard",
    whyItMatters:
      "Latency, error rates, and replay quality need to stay visible before incident claims are exported.",
  },
  {
    checkId: "review-resource-pack",
    surface: "/api/resource-pack",
    whyItMatters:
      "Built-in sample evidence keeps the repo reviewable without live credentials or private telemetry.",
  },
  {
    checkId: "lock-schema",
    surface: "/api/schema/report",
    whyItMatters:
      "A stable report contract prevents handoff notes and exports from drifting.",
  },
] as const;

const VALIDATION_CASES = [
  {
    caseId: "replay-severity-check",
    goal:
      "Severity labels should stay aligned with the replay rubric when the same evidence is re-run.",
    evidence: "/api/evals/replays",
  },
  {
    caseId: "operator-handoff-check",
    goal:
      "Postmortem and live-session views should expose the same incident narrative and next action.",
    evidence: "/api/postmortem-pack",
  },
  {
    caseId: "runtime-contract-check",
    goal:
      "Runtime limits, cache state, and authentication posture should stay visible to operators.",
    evidence: "/api/runtime/scorecard",
  },
  {
    caseId: "export-boundary-check",
    goal:
      "Summary pack and report schema should match before exports or downstream communication.",
    evidence: "/api/summary-pack",
  },
] as const;

export function buildAegisOpsResourcePack() {
  return {
    ok: true,
    service: "aegisops-resource-pack",
    version: 1,
    resourcePackId: "aegisops-resource-pack-v1",
    intendedUse:
      "reviewable incident samples without live providers or private telemetry",
    summary: {
      incidentBundleCount: INCIDENT_BUNDLES.length,
      evidenceAnnotationCount: EVIDENCE_ANNOTATIONS.length,
      operatorCheckCount: OPERATOR_CHECKS.length,
      validationCaseCount: VALIDATION_CASES.length,
    },
    externalData: {
      localOnly: true,
      note: "If local public-incident data is staged, place it under samples/external/incident_response_log/ for operator review.",
      files: {
        incidentLogCsv: {
          path: "samples/external/incident_response_log/incident_event_log.csv",
          preview: [
            "timestamp,service,severity,signal,summary",
            "2026-03-09T09:12:00Z,checkout,SEV1,latency-spike,Queue depth rose while checkout p95 crossed 4s.",
          ],
        },
        incidentSummaryTxt: {
          path: "samples/external/incident_response_log/Incident_response.txt",
          preview: [
            "Commander summary: queue pressure, latency, and retry bursts point to worker exhaustion.",
          ],
        },
      },
    },
    incidentBundles: INCIDENT_BUNDLES,
    evidenceAnnotations: EVIDENCE_ANNOTATIONS,
    operatorChecks: OPERATOR_CHECKS,
    validationCases: VALIDATION_CASES,
    files: {
      incidentBundles: "samples/resource-pack/incident-bundles.json",
      evidenceAnnotations: "samples/resource-pack/evidence-annotations.json",
      operatorChecks: "samples/resource-pack/operator-checks.json",
      validationCases: "samples/resource-pack/validation-cases.json",
    },
    reviewerFastPath: [
      "/api/healthz",
      "/api/runtime/scorecard",
      "/api/resource-pack",
      "/api/system-design-pack",
      "/api/live-session-pack",
      "/api/summary-pack",
      "/api/schema/report",
    ],
  };
}
