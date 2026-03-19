import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import type { IncidentReport } from "../types";
import { loadConfig } from "./lib/config";
import { demoAnalyzeIncident, demoFollowUpAnswer } from "./lib/demo";
import { geminiAnalyzeIncident, geminiFollowUp, geminiTts } from "./lib/gemini";
import { ollamaAnalyzeIncident, ollamaFollowUp } from "./lib/ollama";
import {
  getOperatorAuthStatus,
  isOperatorAuthEnabled,
  readBearerToken,
  requiresOperatorToken,
  validateOperatorAccess,
} from "./lib/operatorAccess";
import {
  applyOperatorSession,
  clearOperatorSessionCookie,
  createOperatorSessionCookie,
  getOperatorSessionCookieName,
  readOperatorSession,
  type OperatorSessionView,
} from "./lib/operatorSession";
import { buildAnalyzeCacheKey, createAnalyzeCache } from "./lib/analyzeCache";
import { buildAegisOpsProviderComparison } from "./lib/providerComparison";
import { buildIncidentReplayEvalOverview, buildIncidentReplayEvalSummary } from "./lib/replayEvals";
import { appendRuntimeEvent, buildRuntimeStoreSummary } from "./lib/runtimeStore";
import {
  appendLiveSessionEvent,
  buildLiveSessionDetail,
  buildLiveSessionList,
  buildLiveSessionStoreSummary,
  normalizeLiveSessionId,
  normalizeLiveSessionLane,
} from "./lib/sessionStore";
import {
  buildAegisOpsLiveSessionPack,
  buildAegisOpsReviewPack,
  buildAegisOpsServiceMeta,
  buildIncidentReportSchema,
} from "./lib/serviceMeta";
import { normalizeAndValidateImages } from "./lib/validation";

type AnalyzeBody = {
  logs?: string;
  images?: { mimeType?: string; data?: string }[];
  lane?: string;
  options?: { enableGrounding?: boolean };
  sessionId?: string;
};

type FollowUpBody = {
  report?: any;
  history?: { role: "user" | "assistant"; content: string }[];
  lane?: string;
  question?: string;
  options?: { enableGrounding?: boolean };
  sessionId?: string;
};

type TtsBody = { text?: string; lane?: string; sessionId?: string };
type ApiKeyBody = { apiKey?: string };
type OperatorSessionBody = { authMode?: string; credential?: string; roles?: string[] | string };
type KeySource = "runtime" | "env" | "ollama" | "none";
type ActiveProvider = "demo" | "gemini" | "ollama";
type OpenAiIncidentBundle = {
  concern: string;
  estimatedCostUsd: number;
  id: string;
  nextReviewPath: string;
  prompt: string;
  severity: string;
  title: string;
};
type RuntimeScorecardFocus = "traffic" | "quality" | "reliability";
type RuntimeEndpointKey =
  | "health"
  | "meta"
  | "review"
  | "replay"
  | "analyze"
  | "followup"
  | "tts"
  | "settings"
  | "other";

type EndpointTelemetry = {
  requests: number;
  errors: number;
  slowRequests: number;
  totalMs: number;
  maxMs: number;
  lastRequestAt?: string;
  lastErrorAt?: string;
  latencyBuckets: Record<string, number>;
};

type FollowUpHistoryItem = { role: "user" | "assistant"; content: string };

declare global {
  namespace Express {
    interface Request {
      operatorSession?: OperatorSessionView | null;
      requestId?: string;
    }
  }
}

const cfg = loadConfig();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const runtimeGeminiApiKey = { value: undefined as string | undefined };
const analyzeCache = createAnalyzeCache<IncidentReport>({
  ttlSec: cfg.analyzeCacheTtlSec,
  maxEntries: cfg.analyzeCacheMaxEntries,
});
const analyzeInFlight = new Map<string, Promise<IncidentReport>>();
const RATE_BUCKET_GC_INTERVAL_MS = 60_000;
const RATE_BUCKET_MAX_SIZE = 10_000;
const startedAt = new Date().toISOString();
const SLOW_REQUEST_MS = 4_000;
const LATENCY_BUCKET_LABELS = ["lt250ms", "250msTo1s", "1sTo4s", "ge4s"] as const;
const runtimeTelemetry = {
  totalRequests: 0,
  totalErrors: 0,
  totalSlowRequests: 0,
  latencyBuckets: {
    lt250ms: 0,
    "250msTo1s": 0,
    "1sTo4s": 0,
    ge4s: 0,
  } as Record<(typeof LATENCY_BUCKET_LABELS)[number], number>,
  endpoints: new Map<RuntimeEndpointKey, EndpointTelemetry>(),
  analyze: {
    cacheHits: 0,
    cacheMisses: 0,
    sharedInflightHits: 0,
    providerCalls: 0,
  },
};
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_PUBLIC_DEFAULT_MODEL = "gpt-4.1-mini";
const OPENAI_PUBLIC_DEFAULT_DAILY_BUDGET_USD = 4;
const OPENAI_PUBLIC_DEFAULT_MONTHLY_BUDGET_USD = 120;
const OPENAI_PUBLIC_DEFAULT_RPM = 6;
const OPENAI_TIMEOUT_MS = 20_000;
const LIVE_ESCALATION_PREVIEW_SCHEMA = "aegisops-live-escalation-preview-v1";
const OPENAI_INCIDENT_BUNDLES: Record<string, OpenAiIncidentBundle> = {
  "checkout-sev1": {
    id: "checkout-sev1",
    title: "Checkout latency spike",
    severity: "SEV1",
    concern: "Latency and error bursts on the checkout path need a clear escalation stance.",
    nextReviewPath: "/api/postmortem-pack",
    estimatedCostUsd: 0.012,
    prompt:
      "Logs show checkout worker timeouts, rising 5xx rates, and command-bridge pressure. A screenshot highlights API latency, queue depth, and payment retries. Decide the escalation stance, human handoff boundary, and reviewer proof path.",
  },
  "billing-degraded": {
    id: "billing-degraded",
    title: "Billing shard degradation",
    severity: "SEV2",
    concern: "Billing remains available but degraded, so commander messaging must stay measured.",
    nextReviewPath: "/api/escalation-readiness",
    estimatedCostUsd: 0.011,
    prompt:
      "Logs show connection-pool saturation on the billing shard, delayed async retries, and contained blast radius. Explain whether this should escalate to commander handoff now or stay in bounded review with evidence collection.",
  },
};
let lastOpenAiLiveRunAt: string | null = null;

const app = express();
app.disable("x-powered-by");
if (cfg.trustProxy) {
  app.set("trust proxy", true);
}

function nextRequestId(): string {
  return `req-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function classifyLatencyBucket(elapsedMs: number): (typeof LATENCY_BUCKET_LABELS)[number] {
  if (elapsedMs < 250) return "lt250ms";
  if (elapsedMs < 1_000) return "250msTo1s";
  if (elapsedMs < 4_000) return "1sTo4s";
  return "ge4s";
}

function classifyEndpoint(path: string): RuntimeEndpointKey {
  if (path.startsWith("/api/analyze")) return "analyze";
  if (path.startsWith("/api/followup")) return "followup";
  if (path.startsWith("/api/tts")) return "tts";
  if (path.startsWith("/api/evals/replays")) return "replay";
  if (
    path.startsWith("/api/meta") ||
    path.startsWith("/api/runtime/scorecard") ||
    path.startsWith("/api/system-design-pack")
  ) {
    return "meta";
  }
  if (
    path.startsWith("/api/reviewer-bundle") ||
    path.startsWith("/api/review-pack") ||
    path.startsWith("/api/postmortem-pack") ||
    path.startsWith("/api/live-session-pack") ||
    path.startsWith("/api/live-sessions") ||
    path.startsWith("/api/schema")
  ) {
    return "review";
  }
  if (path.startsWith("/api/settings")) return "settings";
  if (path.startsWith("/api/healthz")) return "health";
  return "other";
}

function createEndpointTelemetry(): EndpointTelemetry {
  return {
    requests: 0,
    errors: 0,
    slowRequests: 0,
    totalMs: 0,
    maxMs: 0,
    latencyBuckets: {
      lt250ms: 0,
      "250msTo1s": 0,
      "1sTo4s": 0,
      ge4s: 0,
    },
  };
}

function recordRuntimeTelemetry(
  path: string,
  statusCode: number,
  elapsedMs: number,
  options?: {
    method?: string;
    requestId?: string;
  }
): void {
  const endpointKey = classifyEndpoint(path);
  const bucket = classifyLatencyBucket(elapsedMs);
  const now = new Date().toISOString();
  const endpoint = runtimeTelemetry.endpoints.get(endpointKey) ?? createEndpointTelemetry();

  runtimeTelemetry.totalRequests += 1;
  runtimeTelemetry.latencyBuckets[bucket] += 1;
  endpoint.requests += 1;
  endpoint.totalMs += elapsedMs;
  endpoint.maxMs = Math.max(endpoint.maxMs, elapsedMs);
  endpoint.latencyBuckets[bucket] += 1;
  endpoint.lastRequestAt = now;

  if (elapsedMs >= SLOW_REQUEST_MS) {
    runtimeTelemetry.totalSlowRequests += 1;
    endpoint.slowRequests += 1;
  }
  if (statusCode >= 400) {
    runtimeTelemetry.totalErrors += 1;
    endpoint.errors += 1;
    endpoint.lastErrorAt = now;
  }

  runtimeTelemetry.endpoints.set(endpointKey, endpoint);
  try {
    appendRuntimeEvent({
      elapsedMs,
      endpoint: endpointKey,
      method: options?.method || "HTTP",
      path,
      requestId: options?.requestId,
      statusCode,
      timestamp: now,
    });
  } catch (error) {
    logApiEvent("warn", "runtime-telemetry-persist-failed", {
      error: error instanceof Error ? error.message : String(error),
      method: options?.method || "HTTP",
      path,
      requestId: options?.requestId || null,
      statusCode,
    });
  }
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function logApiEvent(
  level: "error" | "info" | "warn",
  event: string,
  payload: Record<string, unknown>
): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    level,
    service: "aegisops-api",
    ...payload,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function normalizeSessionRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function normalizeScorecardFocus(value: unknown): RuntimeScorecardFocus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quality" || normalized === "reliability") return normalized;
  return "traffic";
}

function resolveLiveSessionContext(options: {
  lane?: string;
  requestId?: string;
  sessionId?: string;
}) {
  return {
    lane: normalizeLiveSessionLane(options.lane),
    sessionId: normalizeLiveSessionId(
      options.sessionId,
      options.requestId ? `session-${options.requestId}` : `session-${nextRequestId()}`
    ),
  };
}

function buildRuntimeScorecard(focus: RuntimeScorecardFocus) {
  const persisted = buildRuntimeStoreSummary(10);
  const liveSessions = buildLiveSessionStoreSummary(5);
  const operatorAuth = getOperatorAuthStatus();
  const replaySummary = buildIncidentReplayEvalSummary(cfg.maxLogChars, {
    status: focus === "quality" ? "fail" : undefined,
    limit: focus === "traffic" ? 3 : 4,
  });
  const cacheEntries = analyzeCache.size();
  const endpoints = Array.from(runtimeTelemetry.endpoints.entries())
    .map(([endpoint, telemetry]) => ({
      endpoint,
      requests: telemetry.requests,
      errors: telemetry.errors,
      slowRequests: telemetry.slowRequests,
      averageMs: telemetry.requests > 0 ? Math.round(telemetry.totalMs / telemetry.requests) : 0,
      maxMs: telemetry.maxMs,
      errorRatePct: toPercent(telemetry.errors, telemetry.requests),
      slowRatePct: toPercent(telemetry.slowRequests, telemetry.requests),
      lastRequestAt: telemetry.lastRequestAt || null,
      lastErrorAt: telemetry.lastErrorAt || null,
      latencyBuckets: telemetry.latencyBuckets,
    }))
    .sort((left, right) => right.requests - left.requests || right.errors - left.errors || left.endpoint.localeCompare(right.endpoint));
  const analyzeVolume =
    runtimeTelemetry.analyze.cacheHits +
    runtimeTelemetry.analyze.cacheMisses +
    runtimeTelemetry.analyze.sharedInflightHits;
  const focusSpotlight =
    focus === "quality"
      ? {
          headline: "Replay summary and failure buckets show incident-quality readiness before operator trust.",
          topFailureBuckets: replaySummary.topFailureBuckets,
          spotlightCases: replaySummary.spotlightCases,
        }
      : focus === "reliability"
        ? {
            headline: "Latency, slow routes, and error posture show whether backend runtime is fit for live demos.",
            topEndpoints: endpoints
              .slice()
              .sort((left, right) => right.slowRequests - left.slowRequests || right.errors - left.errors || right.averageMs - left.averageMs)
              .slice(0, 4),
          }
        : {
            headline: "Route volume, cache behavior, and provider mode show where operator traffic is concentrated.",
            topEndpoints: endpoints.slice(0, 4),
          };

  const recommendations = [
    replaySummary.totals.failingCases > 0 ? "Use /api/evals/replays/summary?status=fail before claiming incident quality is production-ready." : null,
    runtimeTelemetry.totalSlowRequests > 0 ? "Inspect slow request buckets and keep provider mode explicit before live demos." : null,
    runtimeTelemetry.totalErrors > 0 ? "Review erroring routes before adding more frontend complexity on top of the runtime." : null,
    analyzeVolume > 0 && runtimeTelemetry.analyze.cacheHits === 0
      ? "Analyze traffic is bypassing cache reuse; compare repeated incident payloads before scaling the live path."
      : null,
    cacheEntries >= Math.floor(cfg.analyzeCacheMaxEntries * 0.8)
      ? "Analyze cache is near capacity; tune TTL or max entries before heavier replay workloads."
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    service: "aegisops-runtime-scorecard",
    version: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    focus,
    provider: getActiveProvider(),
    mode: getMode(),
    summary: {
      totalRequests: runtimeTelemetry.totalRequests,
      totalErrors: runtimeTelemetry.totalErrors,
      totalSlowRequests: runtimeTelemetry.totalSlowRequests,
      errorRatePct: toPercent(runtimeTelemetry.totalErrors, runtimeTelemetry.totalRequests),
      slowRatePct: toPercent(runtimeTelemetry.totalSlowRequests, runtimeTelemetry.totalRequests),
      replayPassRate: replaySummary.totals.passRate,
      replayFailCount: replaySummary.totals.failingCases,
      severityAccuracy: buildIncidentReplayEvalOverview(cfg.maxLogChars).summary.severityAccuracy,
      cacheEntries,
      analyzeCacheHitRatePct: toPercent(runtimeTelemetry.analyze.cacheHits, analyzeVolume),
      sharedInflightReusePct: toPercent(runtimeTelemetry.analyze.sharedInflightHits, analyzeVolume),
      persistedEventCount: persisted.persistedCount,
      liveSessionCount: liveSessions.sessionCount,
      liveSessionEventCount: liveSessions.totalEvents,
    },
    analyzeRuntime: {
      cacheHits: runtimeTelemetry.analyze.cacheHits,
      cacheMisses: runtimeTelemetry.analyze.cacheMisses,
      sharedInflightHits: runtimeTelemetry.analyze.sharedInflightHits,
      providerCalls: runtimeTelemetry.analyze.providerCalls,
      cacheEnabled: analyzeCache.enabled(),
      cacheTtlSec: cfg.analyzeCacheTtlSec,
      cacheMaxEntries: cfg.analyzeCacheMaxEntries,
    },
    latencyBuckets: runtimeTelemetry.latencyBuckets,
    endpoints,
    replaySummary: {
      summaryId: replaySummary.summaryId,
      failCount: replaySummary.totals.failingCases,
      passRate: replaySummary.totals.passRate,
      topFailureBuckets: replaySummary.topFailureBuckets,
    },
    persistence: {
      backend: persisted.backend,
      path: persisted.path,
      enabled: persisted.enabled,
      lastEventAt: persisted.lastEventAt,
      methodCounts: persisted.methodCounts,
      statusClasses: persisted.statusClasses,
      recentEvents: persisted.recentEvents,
    },
    liveSessions,
    operatorAuth: {
      enabled: operatorAuth.enabled,
      mode: operatorAuth.mode,
      protectedRoutes: ["/api/analyze", "/api/followup", "/api/tts"],
      acceptedHeaders: operatorAuth.acceptedHeaders,
      sessionCookie: getOperatorSessionCookieName(),
      roleHeaders: operatorAuth.roleHeaders,
      requiredRoles: operatorAuth.requiredRoles,
      oidc: operatorAuth.oidc,
    },
    spotlight: focusSpotlight,
    recommendations,
    links: {
      healthz: "/api/healthz",
      meta: "/api/meta",
      liveSessions: "/api/live-sessions",
      liveSessionPack: "/api/live-session-pack",
      postmortemPack: "/api/postmortem-pack",
      escalationReadiness: "/api/escalation-readiness",
      systemDesignPack: "/api/system-design-pack",
      reviewPack: "/api/review-pack",
      providerComparison: "/api/evals/providers",
      replaySummary: "/api/evals/replays/summary",
      reportSchema: "/api/schema/report",
      runtimeScorecard: "/api/runtime/scorecard",
      authSession: "/api/auth/session",
    },
  };
}

function buildPostmortemPack() {
  const reviewPack = buildAegisOpsReviewPack({
    deployment: "backend",
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
  });
  const liveSessionPack = buildAegisOpsLiveSessionPack({
    deployment: "backend",
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
  });
  const runtimeScorecard = buildRuntimeScorecard("reliability");
  const reportSchema = buildIncidentReportSchema({
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
  });
  const persisted = buildRuntimeStoreSummary(6);
  const liveSessions = buildLiveSessionStoreSummary(4);
  const evidenceTimeline = [
    ...liveSessions.recentSessions.map((session) => ({
      at: session.lastEventAt,
      detail: `${session.eventCount} event(s) across ${session.lanes.join(", ")}`,
      label: `Session ${session.sessionId}`,
      requestId: null,
      source: "live-session",
    })),
    ...persisted.recentEvents.map((event) => ({
      at: event.timestamp,
      detail: `${event.method} ${event.path} -> ${event.statusCode} in ${event.elapsedMs}ms`,
      label: `Runtime ${event.endpoint}`,
      requestId: event.requestId ?? null,
      source: "runtime-event",
    })),
  ]
    .filter((item) => typeof item.at === "string" && item.at.length > 0)
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 8);

  return {
    ok: true,
    service: "aegisops-postmortem-pack",
    version: 1,
    generatedAt: new Date().toISOString(),
    postmortemPackId: "aegisops-postmortem-pack-v1",
    headline:
      "Evidence-first postmortem pack that ties live incident capture, runtime telemetry, and handoff contract into one reviewable surface.",
    summary: {
      provider: runtimeScorecard.provider,
      mode: runtimeScorecard.mode,
      replayPassRate: runtimeScorecard.summary.replayPassRate,
      replayFailCount: runtimeScorecard.summary.replayFailCount,
      persistedEventCount: persisted.persistedCount,
      liveSessionCount: liveSessions.sessionCount,
      liveSessionEventCount: liveSessions.totalEvents,
      evidenceTimelineCount: evidenceTimeline.length,
    },
    postmortemFlow: [
      {
        stage: "Capture",
        surface: "/api/live-session-pack",
        proof: "Keep screenshots, logs, voice, and request IDs in the same incident bridge.",
      },
      {
        stage: "Stabilize",
        surface: "/api/runtime/scorecard",
        proof: "Check slow routes, replay failures, and provider posture before writing the final narrative.",
      },
      {
        stage: "Explain",
        surface: "/api/postmortem-pack",
        proof: "Compress the evidence timeline, replay quality, and report schema into one reviewer bundle.",
      },
      {
        stage: "Handoff",
        surface: "/api/schema/report",
        proof: "Preserve the incident-report contract all the way to export and downstream action.",
      },
    ],
    evidenceTimeline,
    handoffChecklist: [
      "Confirm the replay summary before treating the incident narrative as a benchmark-quality answer.",
      "Keep live-session evidence and runtime events together so the postmortem is traceable after the bridge ends.",
      "Validate required report fields before exporting to JSON, markdown, Slack, or Jira.",
    ],
    proofBundle: {
      reviewPackId: reviewPack.reviewPackId,
      liveSessionPackId: liveSessionPack.liveSessionPackId,
      reportSchemaId: reportSchema.schemaId,
      replaySummaryId: runtimeScorecard.replaySummary.summaryId,
      runtimeFocus: runtimeScorecard.focus,
      exportFormats: reportSchema.exportFormats,
      recentSessionIds: liveSessions.recentSessions.map((session) => session.sessionId),
      recentRuntimeRoutes: persisted.recentEvents.map((event) => event.path),
    },
    links: {
      healthz: "/api/healthz",
      meta: "/api/meta",
      liveSessions: "/api/live-sessions",
      liveSessionPack: "/api/live-session-pack",
      postmortemPack: "/api/postmortem-pack",
      escalationReadiness: "/api/escalation-readiness",
      systemDesignPack: "/api/system-design-pack",
      reviewPack: "/api/review-pack",
      reviewerBundle: "/api/reviewer-bundle",
      runtimeScorecard: "/api/runtime/scorecard",
      replaySummary: "/api/evals/replays/summary",
      reportSchema: "/api/schema/report",
    },
  };
}

function buildEscalationReadiness() {
  const runtimeScorecard = buildRuntimeScorecard("reliability");
  const postmortemPack = buildPostmortemPack();
  const liveSessionPack = buildAegisOpsLiveSessionPack({
    deployment: "backend",
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
  });
  const providerComparison = buildAegisOpsProviderComparison({
    deployment: "backend",
    activeProvider: getActiveProvider(),
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
    maxLogChars: cfg.maxLogChars,
  });
  const blockers: string[] = [];
  if (runtimeScorecard.summary.replayFailCount > 0) {
    blockers.push("replay_quality_floor");
  }
  if (runtimeScorecard.summary.totalErrors > 0) {
    blockers.push("runtime_error_posture");
  }
  if (postmortemPack.summary.evidenceTimelineCount === 0) {
    blockers.push("missing_evidence_timeline");
  }

  const replayPassRate = Number(runtimeScorecard.summary.replayPassRate || 0);
  const severityAccuracy = Number(runtimeScorecard.summary.severityAccuracy || 0);
  const confidenceBand =
    replayPassRate >= 90 && severityAccuracy >= 90
      ? "high"
      : replayPassRate >= 80 && severityAccuracy >= 75
        ? "moderate"
        : "bounded";

  return {
    ok: true,
    service: "aegisops-escalation-readiness",
    version: 1,
    generatedAt: new Date().toISOString(),
    escalationReadinessId: "aegisops-escalation-readiness-v1",
    headline:
      "Commander-facing escalation surface that compresses replay quality, live evidence, and provider posture into one handoff decision.",
    summary: {
      escalationStatus: blockers.length === 0 ? "ready" : "attention",
      blockerCount: blockers.length,
      blockers,
      provider: runtimeScorecard.provider,
      replayPassRate,
      severityAccuracy,
      liveSessionCount: Number(postmortemPack.summary.liveSessionCount || 0),
      evidenceTimelineCount: Number(postmortemPack.summary.evidenceTimelineCount || 0),
      confidenceBand,
    },
    confidenceBands: [
      {
        band: "high",
        useWhen: "Replay pass rate and severity accuracy are both strong, with live evidence already captured.",
      },
      {
        band: "moderate",
        useWhen: "Runtime posture is acceptable, but a reviewer should still inspect replay failures or evidence gaps before escalation.",
      },
      {
        band: "bounded",
        useWhen: "Treat this as an internal rehearsal surface until replay quality and live evidence improve.",
      },
    ],
    handoffContract: {
      commanderRoles: liveSessionPack.sessionRoles.map((item) => item.role),
      requiredEvidence: [
        "/api/live-session-pack",
        "/api/postmortem-pack",
        "/api/runtime/scorecard",
        "/api/schema/report",
      ],
      approvalRule:
        "Escalate only after replay quality, evidence timeline, and runtime posture are all visible in the same review path.",
      nextAction:
        blockers.length === 0
          ? "Proceed to live commander handoff with the report contract and evidence timeline."
          : `Resolve ${blockers[0]} before treating the incident output as escalation-ready.`,
    },
    providerTradeoff: {
      currentProvider: providerComparison.summary.currentProvider,
      headline: providerComparison.summary.headline,
      compareAgainst: providerComparison.compareAgainst,
    },
    reviewActions: [
      "Read the postmortem pack before sharing a commander-facing narrative.",
      "Use the runtime scorecard to explain whether the backend was stable during the incident bridge.",
      "Keep provider tradeoffs visible so privacy, latency, and multimodal quality are explicit during escalation.",
    ],
    links: {
      healthz: "/api/healthz",
      meta: "/api/meta",
      liveSessionPack: "/api/live-session-pack",
      postmortemPack: "/api/postmortem-pack",
      escalationReadiness: "/api/escalation-readiness",
      systemDesignPack: "/api/system-design-pack",
      reviewPack: "/api/review-pack",
      runtimeScorecard: "/api/runtime/scorecard",
      providerComparison: "/api/evals/providers",
      reportSchema: "/api/schema/report",
    },
  };
}

function buildSystemDesignPack() {
  const runtimeScorecard = buildRuntimeScorecard("reliability");
  const liveSessionPack = buildAegisOpsLiveSessionPack({
    deployment: "backend",
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
  });
  const postmortemPack = buildPostmortemPack();
  const providerComparison = buildAegisOpsProviderComparison({
    deployment: "backend",
    activeProvider: getActiveProvider(),
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
    maxLogChars: cfg.maxLogChars,
  });
  const topEndpoints = runtimeScorecard.endpoints.slice(0, 4);

  return {
    ok: true,
    service: "aegisops-system-design-pack",
    version: 1,
    generatedAt: new Date().toISOString(),
    systemDesignPackId: "aegisops-system-design-pack-v1",
    headline:
      "System-design pack that turns multimodal incident handling, runtime posture, and commander handoff into one big-tech review surface.",
    summary: {
      provider: runtimeScorecard.provider,
      mode: runtimeScorecard.mode,
      totalRequests: runtimeScorecard.summary.totalRequests,
      totalSlowRequests: runtimeScorecard.summary.totalSlowRequests,
      replayPassRate: runtimeScorecard.summary.replayPassRate,
      liveSessionCount: runtimeScorecard.summary.liveSessionCount,
      topologyNodeCount: 5,
      drillCount: 4,
    },
    topology: [
      {
        node: "operator-ui",
        responsibility: "Collect screenshots, logs, voice, and follow-up prompts without dropping incident context.",
        guardrail: "Static demo and backend runtime stay separate so reviewer flow survives backend outages.",
      },
      {
        node: "incident-analysis-api",
        responsibility: "Turn multimodal evidence into a structured incident report through /api/analyze and /api/followup.",
        guardrail: "Protected routes and payload limits keep live mutation lanes bounded.",
      },
      {
        node: "runtime-telemetry",
        responsibility: "Persist request telemetry, latency buckets, and recent error posture for reviewer triage.",
        guardrail: "Scorecards expose slow/error posture before any production-readiness claim is repeated.",
      },
      {
        node: "replay-quality-lane",
        responsibility: "Keep rubric-based replay evals visible so incident quality can be checked independently of provider mode.",
        guardrail: "Replay failures stay explicit and block clean escalation posture.",
      },
      {
        node: "handoff-and-export",
        responsibility: "Compress postmortem evidence, commander handoff, and report schema into export-safe surfaces.",
        guardrail: "Escalation stays gated by evidence timeline, replay posture, and report contract.",
      },
    ],
    trafficEnvelope: {
      protectedRoutes: runtimeScorecard.operatorAuth.protectedRoutes,
      hotEndpoints: topEndpoints.map((endpoint) => ({
        endpoint: endpoint.endpoint,
        requests: endpoint.requests,
        averageMs: endpoint.averageMs,
        slowRatePct: endpoint.slowRatePct,
        errorRatePct: endpoint.errorRatePct,
      })),
      cache: {
        enabled: runtimeScorecard.analyzeRuntime.cacheEnabled,
        ttlSec: runtimeScorecard.analyzeRuntime.cacheTtlSec,
        maxEntries: runtimeScorecard.analyzeRuntime.cacheMaxEntries,
        hitRatePct: runtimeScorecard.summary.analyzeCacheHitRatePct,
        sharedInflightReusePct: runtimeScorecard.summary.sharedInflightReusePct,
      },
      operatorRoles: liveSessionPack.sessionRoles.map((item) => item.role),
    },
    failureDrills: [
      {
        drill: "provider degradation",
        trigger: "Slow requests or runtime errors climb during a live bridge.",
        operatorAction: "Use runtime scorecard plus provider comparison before switching provider posture or falling back to bounded demo mode.",
        reviewSurface: "/api/runtime/scorecard?focus=reliability",
      },
      {
        drill: "evidence gap during commander handoff",
        trigger: "Incident summary exists but screenshots, logs, or timeline evidence are incomplete.",
        operatorAction: "Route through postmortem pack and live session history before escalation.",
        reviewSurface: "/api/postmortem-pack",
      },
      {
        drill: "auth or role boundary regression",
        trigger: "Protected analyze/followup/tts routes are exposed without the expected operator session posture.",
        operatorAction: "Verify operator-auth status before allowing live operator mutation routes.",
        reviewSurface: "/api/runtime/scorecard",
      },
      {
        drill: "quality claim outruns replay evidence",
        trigger: "Runtime looks healthy but replay buckets still show failing cases.",
        operatorAction: "Keep replay summary and escalation readiness in the same reviewer path.",
        reviewSurface: "/api/escalation-readiness",
      },
    ],
    reviewPath: [
      "Start with /api/system-design-pack to explain the system in one pass before diving into implementation details.",
      "Pair it with /api/runtime/scorecard?focus=reliability so topology claims stay grounded in live endpoint telemetry.",
      "Use /api/postmortem-pack and /api/escalation-readiness to show how the design terminates in commander-safe handoff.",
      "Finish on /api/review-pack and /api/schema/report so architecture and report contract stay aligned.",
    ],
    reviewerNotes: [
      "This surface is for reviewable system design and operational drill posture, not a claim of hyperscale fleet traffic.",
      "The strongest public proof is explicit failure handling, reviewer-visible telemetry, and handoff discipline under bounded load.",
      "Use this pack together with replay and postmortem evidence before framing AegisOps as a big-tech-ready incident runtime.",
    ],
    links: {
      healthz: "/api/healthz",
      meta: "/api/meta",
      runtimeScorecard: "/api/runtime/scorecard",
      liveSessions: "/api/live-sessions",
      liveSessionPack: "/api/live-session-pack",
      postmortemPack: "/api/postmortem-pack",
      escalationReadiness: "/api/escalation-readiness",
      systemDesignPack: "/api/system-design-pack",
      reviewPack: "/api/review-pack",
      providerComparison: "/api/evals/providers",
      reportSchema: "/api/schema/report",
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildReviewerBundleDigest(payload: unknown) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function buildReviewerBundle() {
  const reviewPack = buildAegisOpsReviewPack({
    deployment: "backend",
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
  });
  const liveSessionPack = buildAegisOpsLiveSessionPack({
    deployment: "backend",
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
    analyzeModel: getAnalyzeModel(),
    ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
  });
  const runtimeScorecard = buildRuntimeScorecard("quality");
  const reportSchema = buildIncidentReportSchema({
    maxImages: cfg.maxImages,
    maxLogChars: cfg.maxLogChars,
    maxQuestionChars: cfg.maxQuestionChars,
    maxTtsChars: cfg.maxTtsChars,
  });
  const digestPayload = {
    reviewPackId: reviewPack.reviewPackId,
    liveSessionPackId: liveSessionPack.liveSessionPackId,
    reportSchemaId: reportSchema.schemaId,
    provider: runtimeScorecard.provider,
    focus: runtimeScorecard.focus,
    replaySummary: runtimeScorecard.replaySummary,
    operatorAuth: runtimeScorecard.operatorAuth,
    reviewRoutes: reviewPack.links,
  };
  const digest = buildReviewerBundleDigest(digestPayload);

  return {
    ok: true,
    service: "aegisops-reviewer-bundle",
    version: 1,
    generatedAt: new Date().toISOString(),
    reviewerBundleId: "aegisops-reviewer-bundle-v1",
    reviewPackId: reviewPack.reviewPackId,
    liveSessionPackId: liveSessionPack.liveSessionPackId,
    reportSchemaId: reportSchema.schemaId,
    provider: runtimeScorecard.provider,
    bundle: {
      reviewPack,
      liveSessionPack,
      runtimeScorecard: {
        service: runtimeScorecard.service,
        focus: runtimeScorecard.focus,
        summary: runtimeScorecard.summary,
        recommendations: runtimeScorecard.recommendations,
      },
      reportSchema: {
        schemaId: reportSchema.schemaId,
        requiredFields: reportSchema.requiredFields,
        exportFormats: reportSchema.exportFormats,
      },
    },
    integrity: {
      algorithm: "SHA-256",
      digest,
      coveredSections: [
        "reviewPack",
        "liveSessionPack",
        "runtimeScorecard.summary",
        "reportSchema",
        "operatorAuth",
      ],
      verificationRoute: "/api/reviewer-bundle/verify",
    },
    links: {
      healthz: "/api/healthz",
      meta: "/api/meta",
      liveSessionPack: "/api/live-session-pack",
      postmortemPack: "/api/postmortem-pack",
      escalationReadiness: "/api/escalation-readiness",
      systemDesignPack: "/api/system-design-pack",
      reviewPack: "/api/review-pack",
      reviewerBundle: "/api/reviewer-bundle",
      reviewerBundleVerify: "/api/reviewer-bundle/verify",
      runtimeScorecard: "/api/runtime/scorecard",
      reportSchema: "/api/schema/report",
    },
  };
}

function normalizeAddress(value: string | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const noZone = raw.split("%")[0];
  if (noZone.startsWith("::ffff:")) return noZone.slice("::ffff:".length);
  return noZone;
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = normalizeAddress(value);
  if (!normalized) return false;
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

function isLocalRequest(req: express.Request): boolean {
  return isLoopbackAddress(String(req.ip || "")) || isLoopbackAddress(String(req.socket.remoteAddress || ""));
}

function hasApiKeySettingsToken(req: express.Request): boolean {
  const expected = String(cfg.apiKeySettingsToken || "").trim();
  if (!expected) return true;
  const headerToken = String(req.headers["x-api-settings-token"] || "").trim();
  const bearerToken = readBearerToken(String(req.headers.authorization || ""));
  return headerToken === expected || bearerToken === expected;
}

function normalizeIp(req: express.Request): string {
  return String(req.ip || req.socket.remoteAddress || "unknown").replace(/[:.]/g, "_");
}

function cleanExpiredRateBuckets(now = Date.now()): void {
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > RATE_BUCKET_MAX_SIZE) {
    cleanExpiredRateBuckets(now);
  }

  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (bucket.count >= limit) return true;
  bucket.count += 1;
  return false;
}

function sendError(req: express.Request, res: express.Response, status: number, message: string): express.Response {
  return res.status(status).json({
    error: {
      message,
      requestId: req.requestId || nextRequestId(),
    },
  });
}

function classifyErrorStatus(error: unknown): number {
  const e = error as { status?: number; statusCode?: number; message?: string };
  const explicitStatus = Number(e?.status || e?.statusCode || 0);
  if (explicitStatus >= 400 && explicitStatus <= 599) return explicitStatus;

  const message = String(e?.message || "").toLowerCase();
  if (!message) return 500;
  if (message.includes("payload too large")) return 413;
  if (message.includes("missing ") || message.includes("invalid ") || message.includes("unsupported ")) return 400;
  if (message.includes("timed out")) return 504;
  if (message.includes("too many") || message.includes("rate limit") || message.includes("429")) return 429;
  if (message.includes("misconfigured")) return 500;
  if (message.includes("network request failed") || message.includes("failed (")) return 502;
  return 500;
}

function isValidGeminiApiKey(value: string): boolean {
  if (!value) return false;
  if (value.length < 20 || value.length > 256) return false;
  return !/\s/.test(value);
}

function getEffectiveGeminiApiKey(): string | undefined {
  return runtimeGeminiApiKey.value || cfg.geminiApiKey;
}

function getActiveProvider(): ActiveProvider {
  if (cfg.llmProvider === "demo") return "demo";
  if (cfg.llmProvider === "ollama") return "ollama";
  const hasGeminiKey = Boolean(getEffectiveGeminiApiKey());
  if (cfg.llmProvider === "gemini") return hasGeminiKey ? "gemini" : "demo";
  return hasGeminiKey ? "gemini" : "demo";
}

function getMode(): "demo" | "live" {
  return getActiveProvider() === "demo" ? "demo" : "live";
}

function getAnalyzeModel(): string {
  return getActiveProvider() === "ollama" ? cfg.ollamaModelAnalyze : cfg.modelAnalyze;
}

function getFollowUpModel(): string {
  return getActiveProvider() === "ollama" ? cfg.ollamaModelFollowUp : cfg.modelAnalyze;
}

function isBackendConfigured(): boolean {
  if (getActiveProvider() === "ollama") return true;
  return Boolean(getEffectiveGeminiApiKey());
}

function getKeySource(): KeySource {
  if (getActiveProvider() === "ollama") return "ollama";
  if (runtimeGeminiApiKey.value) return "runtime";
  if (cfg.geminiApiKey) return "env";
  return "none";
}

function maskApiKey(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function readUsdEnv(name: string, fallback: number): number {
  const parsed = Number.parseFloat(String(process.env[name] || ""));
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.max(0, Math.round(parsed * 100) / 100);
}

function readClampedIntEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(process.env[name] || ""), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getOpenAiRuntimeContract() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const killSwitch = readBooleanEnv("OPENAI_KILL_SWITCH", false);
  const dailyBudgetUsd = readUsdEnv(
    "OPENAI_PUBLIC_DAILY_BUDGET_USD",
    OPENAI_PUBLIC_DEFAULT_DAILY_BUDGET_USD
  );
  const monthlyBudgetUsd = readUsdEnv(
    "OPENAI_PUBLIC_MONTHLY_BUDGET_USD",
    OPENAI_PUBLIC_DEFAULT_MONTHLY_BUDGET_USD
  );
  const publicLiveApi =
    Boolean(apiKey) &&
    !killSwitch &&
    dailyBudgetUsd > 0 &&
    monthlyBudgetUsd > 0;
  return {
    apiKey,
    dailyBudgetUsd,
    deploymentMode: publicLiveApi ? "public-capped-live" : "review-only-live",
    killSwitch,
    lastLiveRunAt: lastOpenAiLiveRunAt,
    liveModel:
      String(process.env.OPENAI_MODEL_PUBLIC || "").trim() ||
      OPENAI_PUBLIC_DEFAULT_MODEL,
    moderationEnabled: readBooleanEnv("OPENAI_MODERATION_ENABLED", true),
    monthlyBudgetUsd,
    publicLiveApi,
    publicRpm: readClampedIntEnv(
      "OPENAI_PUBLIC_RPM",
      OPENAI_PUBLIC_DEFAULT_RPM,
      1,
      120
    ),
  };
}

async function callOpenAiModeration(apiKey: string, input: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/moderations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });
    if (!response.ok) {
      throw new Error(`Moderation failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      results?: Array<{ flagged?: boolean }>;
    };
    if (payload.results?.[0]?.flagged) {
      throw Object.assign(new Error("content blocked by moderation"), {
        status: 400,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("moderation timed out"), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAiEscalationPreview(options: {
  apiKey: string;
  model: string;
  bundle: OpenAiIncidentBundle;
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a principal incident commander. Return compact JSON with keys escalationStance, confidenceBand, handoffSummary, reviewerEvidence, commanderMessage, nextAction.",
          },
          {
            role: "user",
            content: JSON.stringify(options.bundle),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(payload.choices?.[0]?.message?.content || "").trim();
    if (!content) {
      throw new Error("OpenAI response content was empty");
    }
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error("OpenAI response was not valid JSON"), {
        status: 502,
      });
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("OpenAI request timed out"), {
        status: 504,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

app.use((req, res, next) => {
  req.requestId = String(req.headers["x-request-id"] || nextRequestId());
  req.operatorSession = applyOperatorSession(req);
  res.setHeader("x-request-id", req.requestId);
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");

  const started = Date.now();
  res.on("finish", () => {
    const elapsedMs = Date.now() - started;
    recordRuntimeTelemetry(req.path || req.originalUrl || "", res.statusCode, elapsedMs, {
      method: req.method,
      requestId: req.requestId,
    });
    logApiEvent(res.statusCode >= 400 || elapsedMs >= 4_000 ? "warn" : "info", "request-finished", {
      elapsedMs,
      method: req.method,
      operatorAuthMode: req.operatorSession?.authMode || null,
      operatorRoles: req.operatorSession?.roles || [],
      path: req.originalUrl,
      requestId: req.requestId,
      sessionActive: Boolean(req.operatorSession),
      statusCode: res.statusCode,
    });
  });
  next();
});

app.use(express.json({ limit: `${cfg.requestBodyLimitMb}mb` }));
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === "entity.too.large") {
    return sendError(req, res, 413, "Payload too large.");
  }
  if (err instanceof SyntaxError && "body" in err) {
    return sendError(req, res, 400, "Invalid JSON payload.");
  }
  return next(err);
});

app.use("/api/settings/api-key", (req, res, next) => {
  if (cfg.llmProvider === "ollama" && req.method !== "GET") {
    return sendError(req, res, 409, "API key settings are disabled while LLM_PROVIDER=ollama.");
  }
  if (!cfg.allowRemoteApiKeySettings && !isLocalRequest(req)) {
    return sendError(req, res, 403, "API key settings are restricted to local requests.");
  }
  if (!hasApiKeySettingsToken(req)) {
    return sendError(req, res, 403, "Missing or invalid API key settings token.");
  }
  return next();
});

app.use((req, res, next) => {
  if (!requiresOperatorToken(req)) {
    return next();
  }
  void (async () => {
    const authResult = await validateOperatorAccess(req);
    if (!authResult.ok) {
      return sendError(
        req,
        res,
        403,
        authResult.reason === "missing-role"
          ? "Missing required operator role for runtime mutation route."
          : "Missing or invalid operator credential for runtime mutation route."
      );
    }
    return next();
  })().catch(next);
});

app.get("/api/auth/session", async (req, res) => {
  const session = readOperatorSession(req);
  const authResult = session ? await validateOperatorAccess(req) : null;
  return res.json({
    ok: true,
    requestId: req.requestId,
    active: Boolean(session && authResult?.ok),
    cookieName: getOperatorSessionCookieName(),
    session,
    validation:
      authResult && session
        ? {
            authMode: authResult.authMode,
            ok: authResult.ok,
            reason: authResult.reason,
            roles: authResult.roles,
            subject: authResult.subject,
          }
        : null,
    links: {
      healthz: "/api/healthz",
      systemDesignPack: "/api/system-design-pack",
      runtimeScorecard: "/api/runtime/scorecard",
    },
  });
});

app.post("/api/auth/session", async (req, res) => {
  if (!isOperatorAuthEnabled()) {
    return sendError(req, res, 409, "Operator auth is not configured for session login.");
  }

  const body = (req.body || {}) as OperatorSessionBody;
  const credential = String(body.credential || "").trim();
  const requestedMode = String(body.authMode || "").trim().toLowerCase();
  const roles = normalizeSessionRoles(body.roles);
  if (!credential) {
    return sendError(req, res, 400, "Missing credential.");
  }
  if (requestedMode && requestedMode !== "token" && requestedMode !== "oidc") {
    return sendError(req, res, 400, "authMode must be either 'token' or 'oidc'.");
  }

  const previousAuthorization = req.headers.authorization;
  const previousOperatorToken = req.headers["x-operator-token"];
  const previousOperatorRoles = req.headers["x-operator-roles"];

  delete req.headers.authorization;
  delete req.headers["x-operator-token"];
  delete req.headers["x-operator-roles"];

  if (requestedMode === "oidc") {
    req.headers.authorization = `Bearer ${credential}`;
  } else {
    req.headers["x-operator-token"] = credential;
  }
  if (roles.length > 0) {
    req.headers["x-operator-roles"] = roles.join(",");
  }

  const authResult = await validateOperatorAccess(req);

  if (typeof previousAuthorization === "string") {
    req.headers.authorization = previousAuthorization;
  } else {
    delete req.headers.authorization;
  }
  if (typeof previousOperatorToken === "string") {
    req.headers["x-operator-token"] = previousOperatorToken;
  } else {
    delete req.headers["x-operator-token"];
  }
  if (typeof previousOperatorRoles === "string") {
    req.headers["x-operator-roles"] = previousOperatorRoles;
  } else {
    delete req.headers["x-operator-roles"];
  }

  if (!authResult.ok) {
    return sendError(
      req,
      res,
      403,
      authResult.reason === "missing-role"
        ? "Missing required operator role for session bootstrap."
        : "Missing or invalid operator credential for session bootstrap."
    );
  }

  const sessionCookie = createOperatorSessionCookie({
    authMode: authResult.authMode === "oidc" ? "oidc" : "token",
    credential,
    roles: authResult.roles,
    subject: authResult.subject,
  });
  res.setHeader("set-cookie", sessionCookie.cookie);
  logApiEvent("info", "operator-session-created", {
    authMode: sessionCookie.session.authMode,
    requestId: req.requestId,
    roles: sessionCookie.session.roles,
    subject: sessionCookie.session.subject,
  });
  return res.json({
    ok: true,
    requestId: req.requestId,
    active: true,
    cookieName: getOperatorSessionCookieName(),
    session: sessionCookie.session,
  });
});

app.delete("/api/auth/session", (req, res) => {
  res.setHeader("set-cookie", clearOperatorSessionCookie());
  logApiEvent("info", "operator-session-cleared", {
    requestId: req.requestId,
  });
  return res.json({
    ok: true,
    requestId: req.requestId,
    active: false,
    cookieName: getOperatorSessionCookieName(),
  });
});

app.get("/api/healthz", (req, res) => {
  const provider = getActiveProvider();
  const providerConfigured = isBackendConfigured();
  const cacheEntries = analyzeCache.size();
  const openAi = getOpenAiRuntimeContract();
  res.json({
    ok: true,
    status: "ok",
    service: "aegisops-api",
    requestId: req.requestId,
    startedAt,
    serverTime: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    provider,
    mode: getMode(),
    keySource: getKeySource(),
    keyConfigured: providerConfigured,
    limits: {
      requestBodyLimitMb: cfg.requestBodyLimitMb,
      maxImages: cfg.maxImages,
      maxImageBytes: cfg.maxImageBytes,
      maxLogChars: cfg.maxLogChars,
      maxQuestionChars: cfg.maxQuestionChars,
      maxTtsChars: cfg.maxTtsChars,
      geminiTimeoutMs: cfg.geminiTimeoutMs,
      geminiRetryMaxAttempts: cfg.geminiRetryMaxAttempts,
      geminiRetryBaseDelayMs: cfg.geminiRetryBaseDelayMs,
      analyzeCacheTtlSec: cfg.analyzeCacheTtlSec,
      analyzeCacheMaxEntries: cfg.analyzeCacheMaxEntries,
    },
    defaults: { grounding: cfg.groundingDefault },
    models: {
      analyze: getAnalyzeModel(),
      tts: provider === "ollama" ? "unsupported" : cfg.modelTts,
    },
    caches: {
      analyze: {
        enabled: analyzeCache.enabled(),
        entries: cacheEntries,
        inFlight: analyzeInFlight.size,
      },
    },
    diagnostics: {
      providerConfigured,
      cachePressure: cacheEntries >= Math.floor(cfg.analyzeCacheMaxEntries * 0.8) ? "elevated" : "stable",
      nextAction:
        openAi.publicLiveApi
          ? "use /api/live-escalation-preview with a fixed incidentBundleId for the bounded public live lane."
          : provider === "demo"
          ? "configure Gemini API key or switch to Ollama for live incident analysis."
          : "runtime healthy",
    },
    openai: openAi,
    auth: {
      operatorTokenEnabled: isOperatorAuthEnabled(),
      operatorAuthMode: getOperatorAuthStatus().mode,
      operatorRequiredRoles: getOperatorAuthStatus().requiredRoles,
      operatorRoleHeaders: getOperatorAuthStatus().roleHeaders,
      operatorSessionCookie: getOperatorSessionCookieName(),
      operatorOidc: getOperatorAuthStatus().oidc,
      apiKeySettingsTokenEnabled: Boolean(String(cfg.apiKeySettingsToken || "").trim()),
    },
    ops_contract: {
      schema: "ops-envelope-v1",
      version: 1,
      required_fields: ["service", "status", "diagnostics.nextAction"],
    },
    capabilities: [
      "incident-analysis",
      "follow-up-qna",
      "tts-briefing",
      "runtime-api-key-override",
      "incident-replay-evals",
    ],
    links: {
      apiKey: "/api/settings/api-key",
      analyze: "/api/analyze",
      followup: "/api/followup",
      tts: "/api/tts",
      liveSessions: "/api/live-sessions",
      liveSessionPack: "/api/live-session-pack",
      escalationReadiness: "/api/escalation-readiness",
      liveEscalationPreview: "/api/live-escalation-preview",
      systemDesignPack: "/api/system-design-pack",
      reviewPack: "/api/review-pack",
      replayEvals: "/api/evals/replays",
      replaySummary: "/api/evals/replays/summary",
      providerComparison: "/api/evals/providers",
      runtimeScorecard: "/api/runtime/scorecard",
      authSession: "/api/auth/session",
      meta: "/api/meta",
      reportSchema: "/api/schema/report",
    },
  });
});

app.get("/api/evals/replays", (req, res) => {
  res.json(buildIncidentReplayEvalOverview(cfg.maxLogChars));
});

app.get("/api/evals/replays/summary", (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ""), 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const rawCategory = String(req.query.category || "").trim().toLowerCase();
  const rawStatus = String(req.query.status || "").trim().toLowerCase();
  const status = rawStatus === "pass" || rawStatus === "fail" ? rawStatus : undefined;
  const categories = buildIncidentReplayEvalOverview(cfg.maxLogChars).buckets.map((item) =>
    item.category.toLowerCase()
  );
  const category = rawCategory ? rawCategory : undefined;

  if (rawStatus && !status) {
    return sendError(req, res, 400, "status must be either 'pass' or 'fail'.");
  }
  if (rawCategory && !categories.includes(rawCategory)) {
    return sendError(req, res, 400, "category must match a known replay failure bucket.");
  }

  return res.json(
    buildIncidentReplayEvalSummary(cfg.maxLogChars, {
      category,
      limit,
      status,
    })
  );
});

app.get("/api/evals/providers", (req, res) => {
  return res.json(
    buildAegisOpsProviderComparison({
      deployment: "backend",
      activeProvider: getActiveProvider(),
      analyzeModel: getAnalyzeModel(),
      ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
      maxLogChars: cfg.maxLogChars,
    })
  );
});

app.get("/api/runtime/scorecard", (req, res) => {
  const rawFocus = String(req.query.focus || "").trim().toLowerCase();
  if (rawFocus && rawFocus !== "traffic" && rawFocus !== "quality" && rawFocus !== "reliability") {
    return sendError(req, res, 400, "focus must be one of 'traffic', 'quality', or 'reliability'.");
  }
  return res.json({
    ...buildRuntimeScorecard(normalizeScorecardFocus(rawFocus)),
    openai: getOpenAiRuntimeContract(),
  });
});

app.get("/api/live-sessions", (req, res) => {
  const rawLane = String(req.query.lane || "").trim();
  const rawLimit = Number.parseInt(String(req.query.limit || ""), 10);
  if (
    rawLane &&
    !["incident-command", "commander-handoff", "review", "training"].includes(
      rawLane
    )
  ) {
    return sendError(
      req,
      res,
      400,
      "lane must be incident-command, commander-handoff, review, or training."
    );
  }

  return res.json(
    buildLiveSessionList({
      lane: rawLane ? normalizeLiveSessionLane(rawLane) : undefined,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    })
  );
});

app.get("/api/live-sessions/:sessionId", (req, res) => {
  const sessionId = normalizeLiveSessionId(
    String(req.params.sessionId || ""),
    ""
  );
  if (!sessionId) {
    return sendError(req, res, 400, "Missing sessionId.");
  }
  const detail = buildLiveSessionDetail(sessionId);
  if (!detail) {
    return sendError(req, res, 404, `Unknown live session: ${sessionId}`);
  }
  return res.json(detail);
});

app.get("/api/live-session-pack", (req, res) => {
  res.json(
    buildAegisOpsLiveSessionPack({
      deployment: "backend",
      maxImages: cfg.maxImages,
      maxLogChars: cfg.maxLogChars,
      maxQuestionChars: cfg.maxQuestionChars,
      maxTtsChars: cfg.maxTtsChars,
      analyzeModel: getAnalyzeModel(),
      ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
    })
  );
});

app.get("/api/postmortem-pack", (req, res) => {
  res.json(buildPostmortemPack());
});

app.get("/api/escalation-readiness", (req, res) => {
  res.json(buildEscalationReadiness());
});

app.get("/api/system-design-pack", (req, res) => {
  res.json(buildSystemDesignPack());
});

app.post("/api/live-escalation-preview", async (req, res) => {
  const runtime = getOpenAiRuntimeContract();
  if (!runtime.publicLiveApi) {
    return sendError(
      req,
      res,
      503,
      "public OpenAI live preview is unavailable; configure OPENAI_API_KEY and keep budgets above zero."
    );
  }
  if (
    isRateLimited(
      `${normalizeIp(req)}:live-escalation-preview`,
      runtime.publicRpm,
      60_000
    )
  ) {
    return sendError(req, res, 429, "Too many live escalation preview requests. Please slow down.");
  }

  const incidentBundleId = String((req.body || {}).incidentBundleId || "")
    .trim()
    .toLowerCase();
  const bundle = OPENAI_INCIDENT_BUNDLES[incidentBundleId];
  if (!bundle) {
    return sendError(
      req,
      res,
      400,
      "incidentBundleId must be one of checkout-sev1 or billing-degraded."
    );
  }

  try {
    if (runtime.moderationEnabled) {
      await callOpenAiModeration(runtime.apiKey, bundle.prompt);
    }
    const result = await callOpenAiEscalationPreview({
      apiKey: runtime.apiKey,
      model: runtime.liveModel,
      bundle,
    });
    lastOpenAiLiveRunAt = new Date().toISOString();
    return res.json({
      ok: true,
      schema: LIVE_ESCALATION_PREVIEW_SCHEMA,
      mode: runtime.deploymentMode,
      model: runtime.liveModel,
      scenarioId: bundle.id,
      moderated: true,
      capped: true,
      traceId: req.requestId,
      estimatedCostUsd: bundle.estimatedCostUsd,
      nextReviewPath: bundle.nextReviewPath,
      result: {
        title: bundle.title,
        severity: bundle.severity,
        concern: bundle.concern,
        ...result,
      },
    });
  } catch (error) {
    const status = classifyErrorStatus(error);
    const message =
      error instanceof Error ? error.message : "live escalation preview failed";
    return sendError(req, res, status, message);
  }
});

app.get("/api/meta", (req, res) => {
  res.json(
    {
      ...buildAegisOpsServiceMeta({
      deployment: "backend",
      maxImages: cfg.maxImages,
      maxLogChars: cfg.maxLogChars,
      maxQuestionChars: cfg.maxQuestionChars,
      maxTtsChars: cfg.maxTtsChars,
      analyzeModel: getAnalyzeModel(),
      ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
      }),
      openai: getOpenAiRuntimeContract(),
    }
  );
});

app.get("/api/review-pack", (req, res) => {
  res.json(
    buildAegisOpsReviewPack({
      deployment: "backend",
      maxImages: cfg.maxImages,
      maxLogChars: cfg.maxLogChars,
      maxQuestionChars: cfg.maxQuestionChars,
      maxTtsChars: cfg.maxTtsChars,
      analyzeModel: getAnalyzeModel(),
      ttsModel: getActiveProvider() === "ollama" ? "unsupported" : cfg.modelTts,
    })
  );
});

app.get("/api/reviewer-bundle", (req, res) => {
  res.json(buildReviewerBundle());
});

app.get("/api/reviewer-bundle/verify", (req, res) => {
  const providedDigest = String(req.query.digest || "").trim();
  const bundle = buildReviewerBundle();
  res.json({
    ok: true,
    service: "aegisops-reviewer-bundle-verify",
    version: 1,
    generatedAt: new Date().toISOString(),
    reviewerBundleId: bundle.reviewerBundleId,
    providedDigest: providedDigest || null,
    computedDigest: bundle.integrity.digest,
    match: Boolean(providedDigest) && providedDigest === bundle.integrity.digest,
    verificationRoute: bundle.integrity.verificationRoute,
    coveredSections: bundle.integrity.coveredSections,
  });
});

app.get("/api/schema/report", (req, res) => {
  res.json(
    buildIncidentReportSchema({
      maxImages: cfg.maxImages,
      maxLogChars: cfg.maxLogChars,
      maxQuestionChars: cfg.maxQuestionChars,
      maxTtsChars: cfg.maxTtsChars,
    })
  );
});

app.get("/api/settings/api-key", (req, res) => {
  const provider = getActiveProvider();
  const effectiveKey = getEffectiveGeminiApiKey();
  const source = getKeySource();
  res.json({
    ok: true,
    requestId: req.requestId,
    mode: getMode(),
    source,
    configured: source === "ollama" ? true : Boolean(effectiveKey),
    masked: source === "runtime" || source === "env" ? (effectiveKey ? maskApiKey(effectiveKey) : undefined) : undefined,
    provider,
    persisted: false,
  });
});

app.put("/api/settings/api-key", (req, res) => {
  if (cfg.llmProvider === "ollama") {
    return sendError(req, res, 409, "Runtime Gemini API key is unavailable while LLM_PROVIDER=ollama.");
  }
  const body = (req.body || {}) as ApiKeyBody;
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) return sendError(req, res, 400, "Missing apiKey.");
  if (!isValidGeminiApiKey(apiKey)) {
    return sendError(req, res, 400, "Invalid apiKey format.");
  }

  runtimeGeminiApiKey.value = apiKey;
  return res.json({
    ok: true,
    requestId: req.requestId,
    mode: getMode(),
    source: getKeySource(),
    configured: true,
    masked: maskApiKey(apiKey),
    persisted: false,
  });
});

app.delete("/api/settings/api-key", (req, res) => {
  if (cfg.llmProvider === "ollama") {
    return sendError(req, res, 409, "Runtime Gemini API key is unavailable while LLM_PROVIDER=ollama.");
  }
  runtimeGeminiApiKey.value = undefined;
  const effectiveKey = getEffectiveGeminiApiKey();
  return res.json({
    ok: true,
    requestId: req.requestId,
    mode: getMode(),
    source: getKeySource(),
    configured: Boolean(effectiveKey),
    masked: effectiveKey ? maskApiKey(effectiveKey) : undefined,
    persisted: false,
  });
});

app.post("/api/analyze", async (req, res) => {
  try {
    if (isRateLimited(`analyze:${normalizeIp(req)}`, 40, 60_000)) {
      return sendError(req, res, 429, "Too many analyze requests. Please slow down.");
    }

    const body = (req.body || {}) as AnalyzeBody;

    // Per-session rate limit: max 10 requests per minute per session.
    const sessionKey = String(body.sessionId || "").trim();
    if (sessionKey && isRateLimited(`analyze:session:${sessionKey}`, 10, 60_000)) {
      return sendError(req, res, 429, "Too many analyze requests for this session. Please slow down.");
    }
    const liveSession = resolveLiveSessionContext({
      lane: body.lane,
      requestId: req.requestId,
      sessionId: body.sessionId,
    });
    const logs = String(body.logs || "").slice(0, cfg.maxLogChars);
    const enableGrounding = Boolean(body.options?.enableGrounding ?? cfg.groundingDefault);

    const imagesRaw = Array.isArray(body.images) ? body.images : [];
    const images = normalizeAndValidateImages(imagesRaw, {
      maxImages: cfg.maxImages,
      maxImageBytes: cfg.maxImageBytes,
    });

    const provider = getActiveProvider();
    const modelAnalyze = getAnalyzeModel();

    const cacheKey = buildAnalyzeCacheKey({
      model: `${provider}:${modelAnalyze}`,
      logs,
      images,
      enableGrounding,
    });
    const cached = analyzeCache.get(cacheKey);
    if (cached) {
      runtimeTelemetry.analyze.cacheHits += 1;
      appendLiveSessionEvent({
        eventKind: "analyze",
        imageCount: images.length,
        lane: liveSession.lane,
        logsChars: logs.length,
        provider,
        reportSeverity: cached.severity,
        reportSummary: cached.summary,
        reportTitle: cached.title,
        requestId: req.requestId,
        sessionId: liveSession.sessionId,
        timestamp: new Date().toISOString(),
      });
      return res.json({ ...cached, sessionId: liveSession.sessionId });
    }

    const inFlight = analyzeInFlight.get(cacheKey);
    if (inFlight) {
      runtimeTelemetry.analyze.sharedInflightHits += 1;
      const shared = await inFlight;
      appendLiveSessionEvent({
        eventKind: "analyze",
        imageCount: images.length,
        lane: liveSession.lane,
        logsChars: logs.length,
        provider,
        reportSeverity: shared.severity,
        reportSummary: shared.summary,
        reportTitle: shared.title,
        requestId: req.requestId,
        sessionId: liveSession.sessionId,
        timestamp: new Date().toISOString(),
      });
      return res.json({ ...shared, sessionId: liveSession.sessionId });
    }
    runtimeTelemetry.analyze.cacheMisses += 1;
    runtimeTelemetry.analyze.providerCalls += 1;

    const work =
      provider === "demo"
        ? Promise.resolve(demoAnalyzeIncident({ logs, imageCount: images.length, maxLogChars: cfg.maxLogChars }))
        : provider === "ollama"
        ? ollamaAnalyzeIncident({
            baseUrl: cfg.ollamaBaseUrl,
            model: modelAnalyze,
            logs,
            images,
            maxLogChars: cfg.maxLogChars,
            timeoutMs: cfg.geminiTimeoutMs,
            retryMaxAttempts: cfg.geminiRetryMaxAttempts,
            retryBaseDelayMs: cfg.geminiRetryBaseDelayMs,
          })
        : (() => {
            const effectiveApiKey = getEffectiveGeminiApiKey();
            if (!effectiveApiKey) {
              throw new Error("Server misconfigured: GEMINI_API_KEY missing.");
            }
            return geminiAnalyzeIncident({
              apiKey: effectiveApiKey,
              model: modelAnalyze,
              logs,
              images,
              enableGrounding,
              maxLogChars: cfg.maxLogChars,
              timeoutMs: cfg.geminiTimeoutMs,
              retryMaxAttempts: cfg.geminiRetryMaxAttempts,
              retryBaseDelayMs: cfg.geminiRetryBaseDelayMs,
            });
          })();
    analyzeInFlight.set(cacheKey, work);

    try {
      const report = await work;
      analyzeCache.set(cacheKey, report);
      appendLiveSessionEvent({
        eventKind: "analyze",
        imageCount: images.length,
        lane: liveSession.lane,
        logsChars: logs.length,
        provider,
        reportSeverity: report.severity,
        reportSummary: report.summary,
        reportTitle: report.title,
        requestId: req.requestId,
        sessionId: liveSession.sessionId,
        timestamp: new Date().toISOString(),
      });
      return res.json({ ...report, sessionId: liveSession.sessionId });
    } finally {
      analyzeInFlight.delete(cacheKey);
    }
  } catch (e: any) {
    const message = e?.message || String(e);
    return sendError(req, res, classifyErrorStatus(e), message);
  }
});

app.post("/api/followup", async (req, res) => {
  try {
    if (isRateLimited(`followup:${normalizeIp(req)}`, 120, 60_000)) {
      return sendError(req, res, 429, "Too many follow-up requests. Please slow down.");
    }

    const body = (req.body || {}) as FollowUpBody;
    const liveSession = resolveLiveSessionContext({
      lane: body.lane,
      requestId: req.requestId,
      sessionId: body.sessionId,
    });
    const question = String(body.question || "").trim().slice(0, cfg.maxQuestionChars);
    if (!question) return sendError(req, res, 400, "Missing question.");

    const enableGrounding = Boolean(body.options?.enableGrounding ?? cfg.groundingDefault);
    const report = body.report;
    const historyRaw = Array.isArray(body.history) ? body.history : [];
    const history: FollowUpHistoryItem[] = historyRaw
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-20)
      .map((item) => ({
        role: item.role,
        content: item.content.trim().slice(0, 4_000),
      }))
      .filter((item) => item.content.length > 0);

    const provider = getActiveProvider();
    if (provider === "demo") {
      const answer = demoFollowUpAnswer({ report, question });
      appendLiveSessionEvent({
        eventKind: "followup",
        lane: liveSession.lane,
        provider,
        question,
        requestId: req.requestId,
        reportSeverity: report?.severity,
        reportSummary: report?.summary,
        reportTitle: report?.title,
        sessionId: liveSession.sessionId,
        timestamp: new Date().toISOString(),
      });
      return res.json({ answer, sessionId: liveSession.sessionId });
    }

    const answer =
      provider === "ollama"
        ? await ollamaFollowUp({
            baseUrl: cfg.ollamaBaseUrl,
            model: getFollowUpModel(),
            report,
            history,
            question,
            timeoutMs: cfg.geminiTimeoutMs,
            retryMaxAttempts: cfg.geminiRetryMaxAttempts,
            retryBaseDelayMs: cfg.geminiRetryBaseDelayMs,
          })
        : await (async () => {
            const effectiveApiKey = getEffectiveGeminiApiKey();
            if (!effectiveApiKey) {
              throw new Error("Server misconfigured: GEMINI_API_KEY missing.");
            }
            return geminiFollowUp({
              apiKey: effectiveApiKey,
              model: getFollowUpModel(),
              report,
              history,
              question,
              enableGrounding,
              timeoutMs: cfg.geminiTimeoutMs,
              retryMaxAttempts: cfg.geminiRetryMaxAttempts,
              retryBaseDelayMs: cfg.geminiRetryBaseDelayMs,
            });
          })();
    appendLiveSessionEvent({
      eventKind: "followup",
      lane: liveSession.lane,
      provider,
      question,
      requestId: req.requestId,
      reportSeverity: report?.severity,
      reportSummary: report?.summary,
      reportTitle: report?.title,
      sessionId: liveSession.sessionId,
      timestamp: new Date().toISOString(),
    });
    return res.json({ answer, sessionId: liveSession.sessionId });
  } catch (e: any) {
    const message = e?.message || String(e);
    return sendError(req, res, classifyErrorStatus(e), message);
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    if (isRateLimited(`tts:${normalizeIp(req)}`, 60, 60_000)) {
      return sendError(req, res, 429, "Too many TTS requests. Please slow down.");
    }

    const body = (req.body || {}) as TtsBody;
    const liveSession = resolveLiveSessionContext({
      lane: body.lane,
      requestId: req.requestId,
      sessionId: body.sessionId,
    });
    const text = String(body.text || "").trim().slice(0, cfg.maxTtsChars);
    if (!text) return sendError(req, res, 400, "Missing text.");

    const provider = getActiveProvider();
    if (provider === "demo" || provider === "ollama") {
      appendLiveSessionEvent({
        eventKind: "tts",
        lane: liveSession.lane,
        provider,
        requestId: req.requestId,
        sessionId: liveSession.sessionId,
        timestamp: new Date().toISOString(),
        ttsChars: text.length,
      });
      return res.json({ audioBase64: undefined, sessionId: liveSession.sessionId });
    }

    const effectiveApiKey = getEffectiveGeminiApiKey();
    if (!effectiveApiKey) {
      return sendError(req, res, 500, "Server misconfigured: GEMINI_API_KEY missing.");
    }

    const audioBase64 = await geminiTts({
      apiKey: effectiveApiKey,
      model: cfg.modelTts,
      text,
      timeoutMs: cfg.geminiTimeoutMs,
      retryMaxAttempts: cfg.geminiRetryMaxAttempts,
      retryBaseDelayMs: cfg.geminiRetryBaseDelayMs,
    });
    appendLiveSessionEvent({
      eventKind: "tts",
      lane: liveSession.lane,
      provider,
      requestId: req.requestId,
      sessionId: liveSession.sessionId,
      timestamp: new Date().toISOString(),
      ttsChars: text.length,
    });
    return res.json({ audioBase64, sessionId: liveSession.sessionId });
  } catch (e: any) {
    const message = e?.message || String(e);
    return sendError(req, res, classifyErrorStatus(e), message);
  }
});

app.all("/api/*", (req, res) => sendError(req, res, 404, `Not found: ${req.path}`));

const maintenanceTimer = setInterval(() => {
  cleanExpiredRateBuckets();
  analyzeCache.sweep();
}, RATE_BUCKET_GC_INTERVAL_MS);
if (typeof maintenanceTimer.unref === "function") {
  maintenanceTimer.unref();
}

export { app };

let server: ReturnType<typeof app.listen> | undefined;

export function startServer() {
  if (server) return server;
  server = app.listen(cfg.port, cfg.host, () => {
    logApiEvent("info", "server-started", {
      activeProvider: getActiveProvider(),
      host: cfg.host,
      keySource: getKeySource(),
      llmProvider: cfg.llmProvider,
      port: cfg.port,
      startupMode: cfg.mode,
    });
  });
  return server;
}

function shutdown(signal: string): void {
  logApiEvent("info", "server-shutdown-started", { signal });
  if (!server) {
    process.exit(0);
  }
  server.close((err) => {
    if (err) {
      logApiEvent("error", "server-shutdown-failed", {
        error: err instanceof Error ? err.message : String(err),
        signal,
      });
      process.exit(1);
    }
    logApiEvent("info", "server-shutdown-complete", { signal });
    process.exit(0);
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  startServer();
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
