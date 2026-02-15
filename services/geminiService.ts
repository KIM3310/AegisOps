import type { IncidentReport } from "../types";

export type ApiMode = "demo" | "live";

export interface HealthzResponse {
  ok: boolean;
  mode: ApiMode;
  limits: { maxImages: number; maxLogChars: number };
  defaults: { grounding: boolean };
  models: { analyze: string; tts: string };
}

type ApiErrorBody = { error?: { message?: string } };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // ignore
    }
    const msg = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

export async function fetchHealthz(): Promise<HealthzResponse> {
  return apiFetch<HealthzResponse>("/api/healthz");
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

export const GeminiService = { fetchHealthz, analyzeIncident, generateFollowUp, generateTTS };
export default GeminiService;

