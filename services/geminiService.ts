import type { IncidentReport } from "../types";

export type ApiMode = "demo" | "live";
export type ApiProvider = "demo" | "gemini" | "ollama";
export type ApiKeySource = "runtime" | "env" | "ollama" | "none";

export interface HealthzResponse {
  ok: boolean;
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
}

export interface GeminiApiKeyStatus {
  ok: boolean;
  mode: ApiMode;
  provider?: ApiProvider;
  source: ApiKeySource;
  configured: boolean;
  masked?: string;
  persisted: boolean;
}

type ApiErrorBody = { error?: { message?: string } };
type ApiFetchOptions = { timeoutMs?: number };

const DEFAULT_API_TIMEOUT_MS = 30_000;

function readHeaderObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
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
    throw err instanceof Error ? err : new Error("Network request failed");
  } finally {
    window.clearTimeout(timeoutId);
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
    const requestId = res.headers.get("x-request-id");
    const headerDump = readHeaderObject(res.headers);
    const baseMessage =
      body?.error?.message ||
      (textBody.trim() ? textBody.trim() : `${res.status} ${res.statusText}`);
    const msg = requestId ? `${baseMessage} (request_id=${requestId})` : baseMessage;
    const error = new Error(msg);
    (error as Error & { status?: number; headers?: Record<string, string> }).status = res.status;
    (error as Error & { status?: number; headers?: Record<string, string> }).headers = headerDump;
    throw error;
  }

  return (await res.json()) as T;
}

export async function fetchHealthz(): Promise<HealthzResponse> {
  return apiFetch<HealthzResponse>("/api/healthz");
}

export async function fetchGeminiApiKeyStatus(): Promise<GeminiApiKeyStatus> {
  return apiFetch<GeminiApiKeyStatus>("/api/settings/api-key");
}

export async function saveGeminiApiKey(apiKey: string): Promise<GeminiApiKeyStatus> {
  return apiFetch<GeminiApiKeyStatus>("/api/settings/api-key", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function clearGeminiApiKey(): Promise<GeminiApiKeyStatus> {
  return apiFetch<GeminiApiKeyStatus>("/api/settings/api-key", {
    method: "DELETE",
  });
}

export async function analyzeIncident(
  logs: string,
  images: { mimeType: string; data: string }[] = [],
  options: { enableGrounding?: boolean } = {}
): Promise<IncidentReport> {
  return apiFetch<IncidentReport>("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ logs, images, options }),
  });
}

export async function generateFollowUp(
  report: IncidentReport,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  options: { enableGrounding?: boolean } = {}
): Promise<string> {
  const r = await apiFetch<{ answer: string }>("/api/followup", {
    method: "POST",
    body: JSON.stringify({ report, history, question, options }),
  });
  return r.answer || "No answer generated.";
}

export async function generateTTS(text: string): Promise<string | undefined> {
  const r = await apiFetch<{ audioBase64?: string }>("/api/tts", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return r.audioBase64;
}

export const GeminiService = {
  fetchHealthz,
  fetchGeminiApiKeyStatus,
  saveGeminiApiKey,
  clearGeminiApiKey,
  analyzeIncident,
  generateFollowUp,
  generateTTS,
};
export default GeminiService;
