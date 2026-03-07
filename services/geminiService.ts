import type { IncidentReport, ReplayEvalOverview } from "../types";
import { buildIncidentReplayEvalOverview } from "../server/lib/replayEvals";
import { demoAnalyzeIncident, demoFollowUpAnswer } from "../server/lib/demo";

export type ApiMode = "demo" | "live";
export type ApiProvider = "demo" | "gemini" | "ollama";
export type ApiKeySource = "runtime" | "env" | "ollama" | "none";
export type DeploymentTarget = "backend" | "static-demo";

export interface HealthzResponse {
  ok: boolean;
  status?: string;
  service?: string;
  deployment?: DeploymentTarget;
  startedAt?: string;
  serverTime?: string;
  uptimeSec?: number;
  provider?: ApiProvider;
  mode: ApiMode;
  keySource?: ApiKeySource;
  keyConfigured?: boolean;
  limits: {
    requestBodyLimitMb?: number;
    maxImages: number;
    maxImageBytes?: number;
    maxLogChars: number;
    maxQuestionChars?: number;
    maxTtsChars?: number;
    geminiTimeoutMs?: number;
    geminiRetryMaxAttempts?: number;
    geminiRetryBaseDelayMs?: number;
    analyzeCacheTtlSec?: number;
    analyzeCacheMaxEntries?: number;
  };
  defaults: { grounding: boolean };
  models: { analyze: string; tts: string };
  caches?: {
    analyze?: {
      enabled?: boolean;
      entries?: number;
      inFlight?: number;
    };
  };
  diagnostics?: {
    providerConfigured?: boolean;
    cachePressure?: "stable" | "elevated";
    nextAction?: string;
  };
  ops_contract?: {
    schema?: string;
    version?: number;
    required_fields?: string[];
  };
  capabilities?: string[];
  links?: {
    apiKey?: string;
    analyze?: string;
    followup?: string;
    tts?: string;
    replayEvals?: string;
  };
}

export interface GeminiApiKeyStatus {
  ok: boolean;
  mode: ApiMode;
  deployment?: DeploymentTarget;
  provider?: ApiProvider;
  source: ApiKeySource;
  configured: boolean;
  masked?: string;
  persisted: boolean;
}

type ApiErrorBody = { error?: { message?: string } };
type ApiFetchOptions = { timeoutMs?: number };
type ApiError = Error & { status?: number; headers?: Record<string, string>; code?: string };

const DEFAULT_API_TIMEOUT_MS = 30_000;
const STATIC_DEMO_MAX_LOG_CHARS = 50_000;
const API_UNAVAILABLE_CODE = "API_UNAVAILABLE";

function buildStaticDemoHealthz(): HealthzResponse {
  return {
    ok: true,
    status: "ok",
    service: "aegisops-static-demo",
    deployment: "static-demo",
    mode: "demo",
    provider: "demo",
    keySource: "none",
    keyConfigured: false,
    limits: {
      maxImages: 16,
      maxLogChars: STATIC_DEMO_MAX_LOG_CHARS,
      maxQuestionChars: 4_000,
      maxTtsChars: 0,
    },
    defaults: { grounding: false },
    models: {
      analyze: "Recorded demo",
      tts: "Unavailable",
    },
    diagnostics: {
      providerConfigured: false,
      nextAction: "Static Pages demo is active. Run the local API to use Gemini BYOK and live backend routes.",
    },
    capabilities: ["incident-analysis", "followup", "replay-evals", "workspace-demo"],
  };
}

function buildStaticDemoApiKeyStatus(): GeminiApiKeyStatus {
  return {
    ok: true,
    mode: "demo",
    deployment: "static-demo",
    provider: "demo",
    source: "none",
    configured: false,
    persisted: false,
  };
}

function readHeaderObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function buildApiUnavailableError(message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.code = API_UNAVAILABLE_CODE;
  return error;
}

function isApiUnavailableError(error: unknown): error is ApiError {
  return error instanceof Error && (error as ApiError).code === API_UNAVAILABLE_CODE;
}

function looksLikeHtml(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.startsWith("<!doctype html") ||
    normalized.startsWith("<html") ||
    normalized.includes("<head") ||
    normalized.includes("<body")
  );
}

async function apiFetch<T>(path: string, init?: RequestInit, options: ApiFetchOptions = {}): Promise<T> {
  const timeoutMs = Math.max(1_000, Math.min(120_000, Number(options.timeoutMs || DEFAULT_API_TIMEOUT_MS)));
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    if (path.startsWith("/api/")) {
      throw buildApiUnavailableError("Local API is unavailable.");
    }
    throw err instanceof Error ? err : new Error("Network request failed");
  } finally {
    window.clearTimeout(timeoutId);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (res.ok && path.startsWith("/api/") && contentType.includes("text/html")) {
    throw buildApiUnavailableError("Local API is unavailable.");
  }

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    let textBody = "";
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      try {
        textBody = await res.text();
      } catch {
        // ignore parse failure
      }
    }
    if (path.startsWith("/api/") && (res.status === 404 || res.status === 405 || looksLikeHtml(textBody))) {
      throw buildApiUnavailableError("Local API is unavailable.");
    }
    const requestId = res.headers.get("x-request-id");
    const headerDump = readHeaderObject(res.headers);
    const baseMessage =
      body?.error?.message ||
      (textBody.trim() ? textBody.trim() : `${res.status} ${res.statusText}`);
    const msg = requestId ? `${baseMessage} (request_id=${requestId})` : baseMessage;
    const error = new Error(msg) as ApiError;
    error.status = res.status;
    error.headers = headerDump;
    throw error;
  }

  try {
    return (await res.json()) as T;
  } catch {
    const textBody = await res.text().catch(() => "");
    if (path.startsWith("/api/") && looksLikeHtml(textBody)) {
      throw buildApiUnavailableError("Local API is unavailable.");
    }
    throw new Error("Received a non-JSON response from the API.");
  }
}

export async function fetchHealthz(): Promise<HealthzResponse> {
  try {
    const response = await apiFetch<HealthzResponse>("/api/healthz");
    return {
      ...response,
      deployment: response.deployment || "backend",
    };
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return buildStaticDemoHealthz();
    }
    throw error;
  }
}

export async function fetchReplayEvalOverview(): Promise<ReplayEvalOverview> {
  try {
    return await apiFetch<ReplayEvalOverview>("/api/evals/replays");
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return buildIncidentReplayEvalOverview(STATIC_DEMO_MAX_LOG_CHARS);
    }
    throw error;
  }
}

export async function fetchGeminiApiKeyStatus(): Promise<GeminiApiKeyStatus> {
  try {
    const response = await apiFetch<GeminiApiKeyStatus>("/api/settings/api-key");
    return {
      ...response,
      deployment: response.deployment || "backend",
    };
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return buildStaticDemoApiKeyStatus();
    }
    throw error;
  }
}

export async function saveGeminiApiKey(apiKey: string): Promise<GeminiApiKeyStatus> {
  try {
    return await apiFetch<GeminiApiKeyStatus>("/api/settings/api-key", {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    });
  } catch (error) {
    if (isApiUnavailableError(error)) {
      throw new Error("Runtime API key controls are unavailable in the static demo. Run the local API to use BYOK.");
    }
    throw error;
  }
}

export async function clearGeminiApiKey(): Promise<GeminiApiKeyStatus> {
  try {
    return await apiFetch<GeminiApiKeyStatus>("/api/settings/api-key", {
      method: "DELETE",
    });
  } catch (error) {
    if (isApiUnavailableError(error)) {
      throw new Error("Runtime API key controls are unavailable in the static demo. Run the local API to use BYOK.");
    }
    throw error;
  }
}

export async function analyzeIncident(
  logs: string,
  images: { mimeType: string; data: string }[] = [],
  options: { enableGrounding?: boolean } = {}
): Promise<IncidentReport> {
  try {
    return await apiFetch<IncidentReport>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ logs, images, options }),
    });
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return demoAnalyzeIncident({
        logs,
        imageCount: images.length,
        maxLogChars: STATIC_DEMO_MAX_LOG_CHARS,
      });
    }
    throw error;
  }
}

export async function generateFollowUp(
  report: IncidentReport,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  options: { enableGrounding?: boolean } = {}
): Promise<string> {
  try {
    const r = await apiFetch<{ answer: string }>("/api/followup", {
      method: "POST",
      body: JSON.stringify({ report, history, question, options }),
    });
    return r.answer || "No answer generated.";
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return demoFollowUpAnswer({ report, question });
    }
    throw error;
  }
}

export async function generateTTS(text: string): Promise<string | undefined> {
  try {
    const r = await apiFetch<{ audioBase64?: string }>("/api/tts", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    return r.audioBase64;
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return undefined;
    }
    throw error;
  }
}

export const GeminiService = {
  fetchHealthz,
  fetchReplayEvalOverview,
  fetchGeminiApiKeyStatus,
  saveGeminiApiKey,
  clearGeminiApiKey,
  analyzeIncident,
  generateFollowUp,
  generateTTS,
};
export default GeminiService;
