import dotenv from "dotenv";
dotenv.config();

import { randomUUID } from "node:crypto";
import express from "express";
import type { IncidentReport } from "../types";
import { loadConfig } from "./lib/config";
import { demoAnalyzeIncident, demoFollowUpAnswer } from "./lib/demo";
import { geminiAnalyzeIncident, geminiFollowUp, geminiTts } from "./lib/gemini";
import { ollamaAnalyzeIncident, ollamaFollowUp } from "./lib/ollama";
import { buildAnalyzeCacheKey, createAnalyzeCache } from "./lib/analyzeCache";
import { normalizeAndValidateImages } from "./lib/validation";

type AnalyzeBody = {
  logs?: string;
  images?: { mimeType?: string; data?: string }[];
  options?: { enableGrounding?: boolean };
};

type FollowUpBody = {
  report?: any;
  history?: { role: "user" | "assistant"; content: string }[];
  question?: string;
  options?: { enableGrounding?: boolean };
};

type TtsBody = { text?: string };
type ApiKeyBody = { apiKey?: string };
type KeySource = "runtime" | "env" | "ollama" | "none";
type ActiveProvider = "demo" | "gemini" | "ollama";

type FollowUpHistoryItem = { role: "user" | "assistant"; content: string };

declare global {
  namespace Express {
    interface Request {
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

const app = express();
app.disable("x-powered-by");
if (cfg.trustProxy) {
  app.set("trust proxy", true);
}

function nextRequestId(): string {
  return `req-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

function readBearerToken(value: string | undefined): string {
  const auth = String(value || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice("bearer ".length).trim();
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

app.use((req, res, next) => {
  req.requestId = String(req.headers["x-request-id"] || nextRequestId());
  res.setHeader("x-request-id", req.requestId);
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");

  const started = Date.now();
  res.on("finish", () => {
    const elapsedMs = Date.now() - started;
    if (res.statusCode >= 400 || elapsedMs >= 4_000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[api] ${req.method} ${req.originalUrl} status=${res.statusCode} ms=${elapsedMs} requestId=${req.requestId}`
      );
    }
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

app.get("/api/healthz", (req, res) => {
  const provider = getActiveProvider();
  res.json({
    ok: true,
    requestId: req.requestId,
    startedAt,
    serverTime: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    provider,
    mode: getMode(),
    keySource: getKeySource(),
    keyConfigured: isBackendConfigured(),
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
        entries: analyzeCache.size(),
        inFlight: analyzeInFlight.size,
      },
    },
  });
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
    const logs = String(body.logs || "").slice(0, cfg.maxLogChars);
    const enableGrounding = Boolean(body.options?.enableGrounding ?? cfg.groundingDefault);

    const imagesRaw = Array.isArray(body.images) ? body.images : [];
    const images = normalizeAndValidateImages(imagesRaw, {
      maxImages: cfg.maxImages,
      maxImageBytes: cfg.maxImageBytes,
    });

    const provider = getActiveProvider();
    if (provider === "demo") {
      const report = demoAnalyzeIncident({ logs, imageCount: images.length, maxLogChars: cfg.maxLogChars });
      return res.json(report);
    }

    const modelAnalyze = getAnalyzeModel();

    const cacheKey = buildAnalyzeCacheKey({
      model: `${provider}:${modelAnalyze}`,
      logs,
      images,
      enableGrounding,
    });
    const cached = analyzeCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const inFlight = analyzeInFlight.get(cacheKey);
    if (inFlight) {
      const shared = await inFlight;
      return res.json(shared);
    }

    const work =
      provider === "ollama"
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
      return res.json(report);
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
      return res.json({ answer });
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
    return res.json({ answer });
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
    const text = String(body.text || "").trim().slice(0, cfg.maxTtsChars);
    if (!text) return sendError(req, res, 400, "Missing text.");

    const provider = getActiveProvider();
    if (provider === "demo" || provider === "ollama") return res.json({ audioBase64: undefined });

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
    return res.json({ audioBase64 });
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

const server = app.listen(cfg.port, cfg.host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[api] AegisOps API listening on http://${cfg.host}:${cfg.port} (startupMode=${cfg.mode}, provider=${cfg.llmProvider}, activeProvider=${getActiveProvider()}, keySource=${getKeySource()})`
  );
});

function shutdown(signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`[api] Received ${signal}. Shutting down gracefully...`);
  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[api] Graceful shutdown failed:", err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
