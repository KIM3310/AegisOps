/**
 * Datadog Integration Adapter for AegisOps
 *
 * Provides custom metrics submission (incident count, severity distribution,
 * analysis latency), and APM tracing header propagation.
 *
 * All functionality is gated by the DD_API_KEY env var.
 * When the env var is absent, every public function is a safe no-op.
 */

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatadogConfig {
  apiKey: string;
  appKey?: string;
  site: string;
  service: string;
  env: string;
}

export interface DatadogMetricPoint {
  metric: string;
  type: "count" | "gauge" | "rate";
  points: Array<{ timestamp: number; value: number }>;
  tags?: string[];
}

export interface DatadogMetricSubmitResult {
  accepted: number;
  submittedAt: string;
}

export interface DatadogTracingHeaders {
  "x-datadog-trace-id": string;
  "x-datadog-parent-id": string;
  "x-datadog-sampling-priority": string;
  "x-datadog-origin": string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadDatadogConfig(): DatadogConfig | null {
  const apiKey = (process.env.DD_API_KEY ?? "").trim();
  if (!apiKey) return null;

  return {
    apiKey,
    appKey: (process.env.DD_APP_KEY ?? "").trim() || undefined,
    site: (process.env.DD_SITE ?? "datadoghq.com").trim(),
    service: (process.env.DD_SERVICE ?? "aegisops").trim(),
    env: (process.env.DD_ENV ?? "production").trim(),
  };
}

let cachedConfig: DatadogConfig | null | undefined;

function getConfig(): DatadogConfig | null {
  if (cachedConfig === undefined) {
    cachedConfig = loadDatadogConfig();
  }
  return cachedConfig;
}

// ---------------------------------------------------------------------------
// Metrics buffer for batched submission
// ---------------------------------------------------------------------------

const metricsBuffer: DatadogMetricPoint[] = [];
const FLUSH_INTERVAL_MS = 10_000;
const MAX_BUFFER_SIZE = 500;

let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushMetrics();
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === "function") {
    flushTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true when Datadog integration is configured and available. */
export function isDatadogEnabled(): boolean {
  return getConfig() !== null;
}

/** Return a sanitised view of the current Datadog config (no secrets). */
export function getDatadogStatus(): {
  enabled: boolean;
  site: string | null;
  service: string | null;
  env: string | null;
  appKeyConfigured: boolean;
  bufferedMetrics: number;
} {
  const cfg = getConfig();
  if (!cfg) {
    return {
      enabled: false,
      site: null,
      service: null,
      env: null,
      appKeyConfigured: false,
      bufferedMetrics: 0,
    };
  }
  return {
    enabled: true,
    site: cfg.site,
    service: cfg.service,
    env: cfg.env,
    appKeyConfigured: Boolean(cfg.appKey),
    bufferedMetrics: metricsBuffer.length,
  };
}

/**
 * Submit a batch of custom metrics to the Datadog API.
 *
 * Uses the v2 metrics intake endpoint.
 */
export async function submitMetrics(
  metrics: DatadogMetricPoint[]
): Promise<DatadogMetricSubmitResult | null> {
  const cfg = getConfig();
  if (!cfg) return null;
  if (metrics.length === 0) return { accepted: 0, submittedAt: new Date().toISOString() };

  const url = `https://api.${cfg.site}/api/v2/series`;
  const payload = JSON.stringify({
    series: metrics.map((m) => ({
      metric: m.metric,
      type: m.type === "count" ? 1 : m.type === "rate" ? 2 : 3,
      points: m.points.map((p) => ({
        timestamp: p.timestamp,
        value: p.value,
      })),
      tags: [
        `service:${cfg.service}`,
        `env:${cfg.env}`,
        ...(m.tags ?? []),
      ],
    })),
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": cfg.apiKey,
      },
      body: payload,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(
        { event: "datadog-metrics-submit-failed", status: response.status, errBody },
        "Datadog metrics submission failed"
      );
      return null;
    }

    logger.info(
      { event: "datadog-metrics-submit-success", count: metrics.length },
      "Datadog metrics submitted"
    );

    return {
      accepted: metrics.length,
      submittedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(
      { event: "datadog-metrics-submit-error", error: error instanceof Error ? error.message : String(error) },
      "Datadog metrics submit error"
    );
    return null;
  }
}

/**
 * Buffer a metric point for batched submission.
 * Metrics are flushed automatically every 10 seconds or when the buffer reaches capacity.
 */
export function bufferMetric(
  metric: string,
  value: number,
  type: "count" | "gauge" | "rate" = "gauge",
  tags: string[] = []
): void {
  if (!getConfig()) return;

  metricsBuffer.push({
    metric,
    type,
    points: [{ timestamp: Math.floor(Date.now() / 1000), value }],
    tags,
  });

  ensureFlushTimer();

  if (metricsBuffer.length >= MAX_BUFFER_SIZE) {
    void flushMetrics();
  }
}

/**
 * Flush all buffered metrics to Datadog.
 */
export async function flushMetrics(): Promise<DatadogMetricSubmitResult | null> {
  if (metricsBuffer.length === 0) return null;

  const batch = metricsBuffer.splice(0, metricsBuffer.length);
  return submitMetrics(batch);
}

// ---------------------------------------------------------------------------
// Pre-built metric helpers for AegisOps domain events
// ---------------------------------------------------------------------------

/** Record a completed incident analysis. */
export function recordIncidentAnalysis(options: {
  provider: string;
  severity: string;
  latencyMs: number;
  cached: boolean;
}): void {
  bufferMetric("aegisops.analysis.count", 1, "count", [
    `provider:${options.provider}`,
    `severity:${options.severity}`,
    `cached:${options.cached}`,
  ]);
  bufferMetric("aegisops.analysis.latency_ms", options.latencyMs, "gauge", [
    `provider:${options.provider}`,
  ]);
  bufferMetric(`aegisops.analysis.severity.${options.severity.toLowerCase()}`, 1, "count", [
    `provider:${options.provider}`,
  ]);
}

/** Record a follow-up Q&A interaction. */
export function recordFollowUp(options: {
  provider: string;
  latencyMs: number;
}): void {
  bufferMetric("aegisops.followup.count", 1, "count", [
    `provider:${options.provider}`,
  ]);
  bufferMetric("aegisops.followup.latency_ms", options.latencyMs, "gauge", [
    `provider:${options.provider}`,
  ]);
}

/** Record an HTTP request for APM-style metrics. */
export function recordHttpRequest(options: {
  method: string;
  route: string;
  statusCode: number;
  latencyMs: number;
}): void {
  bufferMetric("aegisops.http.request.count", 1, "count", [
    `method:${options.method}`,
    `route:${options.route}`,
    `status:${options.statusCode}`,
  ]);
  bufferMetric("aegisops.http.request.latency_ms", options.latencyMs, "gauge", [
    `method:${options.method}`,
    `route:${options.route}`,
  ]);
  if (options.statusCode >= 400) {
    bufferMetric("aegisops.http.request.errors", 1, "count", [
      `method:${options.method}`,
      `route:${options.route}`,
      `status:${options.statusCode}`,
    ]);
  }
}

/** Record provider usage distribution. */
export function recordProviderUsage(provider: string): void {
  bufferMetric("aegisops.provider.usage", 1, "count", [
    `provider:${provider}`,
  ]);
}

/**
 * Generate Datadog APM tracing headers for outbound requests.
 *
 * These can be attached to upstream calls (e.g., to Gemini or Ollama)
 * so that distributed traces connect the AegisOps API to LLM providers.
 */
export function buildTracingHeaders(requestId?: string): DatadogTracingHeaders | null {
  if (!getConfig()) return null;

  // Generate a pseudo trace/span ID from the request ID or random bytes
  const seed = requestId ?? `${Date.now()}-${Math.random()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const traceId = String(Math.abs(hash) * 1000000 + Math.floor(Math.random() * 1000000));
  const parentId = String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  return {
    "x-datadog-trace-id": traceId,
    "x-datadog-parent-id": parentId,
    "x-datadog-sampling-priority": "1",
    "x-datadog-origin": "aegisops",
  };
}

/**
 * Reset cached config (useful for testing).
 */
export function resetDatadogConfig(): void {
  cachedConfig = undefined;
  metricsBuffer.length = 0;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
