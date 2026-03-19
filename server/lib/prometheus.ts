/**
 * Prometheus Metrics Collector for AegisOps
 *
 * Tracks request count, latency histogram, analysis success/failure rates,
 * and provider usage distribution. Exposes metrics in Prometheus text format
 * via GET /api/metrics.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistogramBucket {
  le: number | "+Inf";
  count: number;
}

interface MetricLabels {
  [key: string]: string;
}

interface CounterEntry {
  labels: MetricLabels;
  value: number;
}

interface HistogramEntry {
  labels: MetricLabels;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Histogram bucket boundaries (in seconds for latency)
// ---------------------------------------------------------------------------

const LATENCY_BUCKET_BOUNDARIES = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function createBuckets(): HistogramBucket[] {
  return [
    ...LATENCY_BUCKET_BOUNDARIES.map((le) => ({ le, count: 0 })),
    { le: "+Inf" as const, count: 0 },
  ];
}

// ---------------------------------------------------------------------------
// Metrics storage
// ---------------------------------------------------------------------------

const counters = new Map<string, CounterEntry[]>();
const histograms = new Map<string, HistogramEntry[]>();

function getOrCreateCounter(name: string, labels: MetricLabels): CounterEntry {
  const entries = counters.get(name) ?? [];
  if (!counters.has(name)) counters.set(name, entries);

  const key = JSON.stringify(labels);
  let entry = entries.find((e) => JSON.stringify(e.labels) === key);
  if (!entry) {
    entry = { labels, value: 0 };
    entries.push(entry);
  }
  return entry;
}

function getOrCreateHistogram(name: string, labels: MetricLabels): HistogramEntry {
  const entries = histograms.get(name) ?? [];
  if (!histograms.has(name)) histograms.set(name, entries);

  const key = JSON.stringify(labels);
  let entry = entries.find((e) => JSON.stringify(e.labels) === key);
  if (!entry) {
    entry = { labels, buckets: createBuckets(), sum: 0, count: 0 };
    entries.push(entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Public recording API
// ---------------------------------------------------------------------------

/** Increment a counter metric. */
export function incCounter(name: string, labels: MetricLabels = {}, delta = 1): void {
  const entry = getOrCreateCounter(name, labels);
  entry.value += delta;
}

/** Observe a value into a histogram. */
export function observeHistogram(name: string, labels: MetricLabels, value: number): void {
  const entry = getOrCreateHistogram(name, labels);
  entry.sum += value;
  entry.count += 1;
  for (const bucket of entry.buckets) {
    if (bucket.le === "+Inf" || value <= bucket.le) {
      bucket.count += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-built recording helpers
// ---------------------------------------------------------------------------

/** Record an HTTP request (call from middleware). */
export function recordHttpRequest(options: {
  method: string;
  route: string;
  statusCode: number;
  durationSec: number;
}): void {
  incCounter("aegisops_http_requests_total", {
    method: options.method,
    route: options.route,
    status: String(options.statusCode),
  });

  observeHistogram(
    "aegisops_http_request_duration_seconds",
    { method: options.method, route: options.route },
    options.durationSec
  );

  if (options.statusCode >= 500) {
    incCounter("aegisops_http_server_errors_total", {
      method: options.method,
      route: options.route,
    });
  }
}

/** Record an incident analysis attempt. */
export function recordAnalysis(options: {
  provider: string;
  success: boolean;
  durationSec: number;
  cached: boolean;
}): void {
  const status = options.success ? "success" : "failure";
  incCounter("aegisops_analysis_total", {
    provider: options.provider,
    status,
    cached: String(options.cached),
  });

  observeHistogram(
    "aegisops_analysis_duration_seconds",
    { provider: options.provider },
    options.durationSec
  );
}

/** Record provider usage. */
export function recordProviderUsage(provider: string): void {
  incCounter("aegisops_provider_requests_total", { provider });
}

/** Record follow-up Q&A. */
export function recordFollowUp(options: {
  provider: string;
  success: boolean;
  durationSec: number;
}): void {
  incCounter("aegisops_followup_total", {
    provider: options.provider,
    status: options.success ? "success" : "failure",
  });

  observeHistogram(
    "aegisops_followup_duration_seconds",
    { provider: options.provider },
    options.durationSec
  );
}

/** Record TTS request. */
export function recordTts(options: {
  provider: string;
  success: boolean;
}): void {
  incCounter("aegisops_tts_total", {
    provider: options.provider,
    status: options.success ? "success" : "failure",
  });
}

// ---------------------------------------------------------------------------
// Prometheus text format serialization
// ---------------------------------------------------------------------------

function formatLabels(labels: MetricLabels): string {
  const pairs = Object.entries(labels);
  if (pairs.length === 0) return "";
  return `{${pairs.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}

function serializeCounter(name: string, help: string): string {
  const entries = counters.get(name);
  if (!entries || entries.length === 0) return "";

  const lines: string[] = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
  ];
  for (const entry of entries) {
    lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
  }
  return lines.join("\n");
}

function serializeHistogram(name: string, help: string): string {
  const entries = histograms.get(name);
  if (!entries || entries.length === 0) return "";

  const lines: string[] = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} histogram`,
  ];

  for (const entry of entries) {
    const baseLabelStr = formatLabels(entry.labels);
    const baseLabelPrefix = Object.keys(entry.labels).length > 0
      ? Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(",") + ","
      : "";

    for (const bucket of entry.buckets) {
      lines.push(`${name}_bucket{${baseLabelPrefix}le="${bucket.le}"} ${bucket.count}`);
    }
    lines.push(`${name}_sum${baseLabelStr} ${entry.sum}`);
    lines.push(`${name}_count${baseLabelStr} ${entry.count}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export: generate full metrics page
// ---------------------------------------------------------------------------

const METRIC_DEFINITIONS: Array<{
  name: string;
  help: string;
  type: "counter" | "histogram";
}> = [
  { name: "aegisops_http_requests_total", help: "Total HTTP requests", type: "counter" },
  { name: "aegisops_http_request_duration_seconds", help: "HTTP request duration in seconds", type: "histogram" },
  { name: "aegisops_http_server_errors_total", help: "Total HTTP 5xx server errors", type: "counter" },
  { name: "aegisops_analysis_total", help: "Total incident analysis requests", type: "counter" },
  { name: "aegisops_analysis_duration_seconds", help: "Incident analysis duration in seconds", type: "histogram" },
  { name: "aegisops_provider_requests_total", help: "Requests by LLM provider", type: "counter" },
  { name: "aegisops_followup_total", help: "Total follow-up Q&A requests", type: "counter" },
  { name: "aegisops_followup_duration_seconds", help: "Follow-up Q&A duration in seconds", type: "histogram" },
  { name: "aegisops_tts_total", help: "Total TTS requests", type: "counter" },
];

/** Serialize all collected metrics into Prometheus text exposition format. */
export function serializeMetrics(): string {
  const sections: string[] = [];
  const emitted = new Set<string>();

  for (const def of METRIC_DEFINITIONS) {
    emitted.add(def.name);
    const serialized =
      def.type === "counter"
        ? serializeCounter(def.name, def.help)
        : serializeHistogram(def.name, def.help);
    if (serialized) {
      sections.push(serialized);
    }
  }

  // Emit any dynamically created counters not in the predefined list
  for (const name of counters.keys()) {
    if (!emitted.has(name)) {
      emitted.add(name);
      const serialized = serializeCounter(name, name);
      if (serialized) sections.push(serialized);
    }
  }

  // Emit any dynamically created histograms not in the predefined list
  for (const name of histograms.keys()) {
    if (!emitted.has(name)) {
      emitted.add(name);
      const serialized = serializeHistogram(name, name);
      if (serialized) sections.push(serialized);
    }
  }

  return sections.join("\n\n") + "\n";
}

/** Reset all metrics (useful for testing). */
export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
}
