import type { IncidentReport } from "../../types";
import { extractJsonBlock, tryRepairAndParseJson } from "./json";

type ImageInput = { mimeType: string; data: string };

type OllamaRole = "system" | "user" | "assistant";

type OllamaMessage = {
  role: OllamaRole;
  content: string;
  images?: string[];
};

function clampText(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 20))}\n\n...[truncated ${t.length - max} chars]`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message || "";
  return String(error);
}

function isRetriableOllamaError(error: unknown): boolean {
  const msg = asMessage(error).toLowerCase();
  if (!msg) return false;
  const patterns = [
    "429",
    "rate limit",
    "too many requests",
    "internal server error",
    "unavailable",
    "temporarily unavailable",
    "timed out",
    "timeout",
    "network",
    "econnreset",
    "socket hang up",
    "502",
    "503",
    "504",
  ];
  return patterns.some((p) => msg.includes(p));
}

function asString(value: unknown, fallback = "", maxChars = 2_000): string {
  const v = typeof value === "string" ? value : fallback;
  return clampText(v, maxChars);
}

function asStringArray(value: unknown, maxItems = 12, maxChars = 400): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((x) => asString(x, "", maxChars))
    .filter((x) => x.length > 0);
}

function normalizeTimeline(value: unknown): IncidentReport["timeline"] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 30)
    .map((item: any) => {
      const severity = ["critical", "warning", "info", "success"].includes(item?.severity)
        ? item.severity
        : undefined;
      return {
        time: asString(item?.time, "Unknown", 32),
        description: asString(item?.description, "", 400),
        ...(severity ? { severity } : {}),
      };
    })
    .filter((x) => x.description.length > 0);
}

function normalizeActionItems(value: unknown): IncidentReport["actionItems"] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item: any) => {
      const priority = ["HIGH", "MEDIUM", "LOW"].includes(item?.priority) ? item.priority : "MEDIUM";
      const task = asString(item?.task, "", 500);
      const owner = asString(item?.owner, "", 120);
      return {
        task,
        priority,
        ...(owner ? { owner } : {}),
      };
    })
    .filter((x) => x.task.length > 0);
}

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
}

async function withRetry<T>(input: {
  label: string;
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  op: (timeoutMs: number) => Promise<T>;
}): Promise<T> {
  const maxAttempts = clampNumber(Number(input.maxAttempts || 1), 1, 6);
  const timeoutMs = clampNumber(Number(input.timeoutMs || 45_000), 5_000, 180_000);
  const baseDelayMs = clampNumber(Number(input.baseDelayMs || 400), 50, 5_000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await input.op(timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetriableOllamaError(error)) {
        throw error;
      }
      const jitter = 0.7 + Math.random() * 0.6;
      const delay = clampNumber(Math.round(baseDelayMs * Math.pow(2, attempt - 1) * jitter), 50, 10_000);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${input.label} failed.`);
}

async function ollamaChat(input: {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  temperature?: number;
  formatJson?: boolean;
}): Promise<string> {
  const url = `${normalizeBaseUrl(input.baseUrl)}/api/chat`;

  const text = await withRetry({
    label: "Ollama chat request",
    timeoutMs: input.timeoutMs,
    maxAttempts: input.retryMaxAttempts,
    baseDelayMs: input.retryBaseDelayMs,
    op: async (timeoutMs) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: input.model,
            stream: false,
            format: input.formatJson ? "json" : undefined,
            messages: input.messages,
            options: {
              temperature: typeof input.temperature === "number" ? input.temperature : 0.2,
            },
          }),
        });

        if (!res.ok) {
          const body = (await res.text().catch(() => "")).trim();
          throw new Error(
            `Ollama request failed (${res.status} ${res.statusText})${body ? `: ${body.slice(0, 500)}` : ""}`
          );
        }

        const payload = (await res.json().catch(() => ({}))) as any;
        const content = String(payload?.message?.content || "").trim();
        if (!content) throw new Error("Empty response from Ollama.");
        return content;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Ollama request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        }
        if (error instanceof TypeError) {
          throw new Error(`Network request failed while calling Ollama at ${url}. Is Ollama running?`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  });

  return text;
}

const ANALYZE_SYSTEM_INSTRUCTION = `You are a Principal SRE. Analyze incident logs and produce a decision-ready post-incident report.

Rules:
- Do not invent facts or metrics. If data is missing, write "Unknown" or "Investigation Needed".
- Output ONLY raw valid JSON. No markdown fences, no commentary.
- Keep the "reasoning" field concise with sections: "Observations", "Hypotheses", "Decision Path".

Schema:
{
  "title": "Concise title",
  "summary": "Executive summary",
  "severity": "SEV1|SEV2|SEV3|UNKNOWN",
  "rootCauses": ["..."],
  "reasoning": "Evidence-based reasoning trace",
  "confidenceScore": 0,
  "timeline": [{"time":"HH:mm:ss","description":"...","severity":"critical|warning|info|success"}],
  "actionItems": [{"task":"...","owner":"Role","priority":"HIGH|MEDIUM|LOW"}],
  "mitigationSteps": ["..."],
  "impact": {"estimatedUsersAffected":"...","duration":"...","peakLatency":"...","peakErrorRate":"..."},
  "tags": ["..."],
  "lessonsLearned": "...",
  "preventionRecommendations": ["..."]
}`;

export async function ollamaAnalyzeIncident(input: {
  baseUrl: string;
  model: string;
  logs: string;
  images: ImageInput[];
  maxLogChars: number;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<IncidentReport> {
  const logs = clampText(input.logs, input.maxLogChars);
  const imageCount = input.images.filter((img) => Boolean(img?.data)).length;
  const userPrompt = [
    "Analyze this incident using the logs below.",
    "If image evidence is unavailable to the selected model, do not infer image contents.",
    `Attached screenshot count: ${imageCount}.`,
    "",
    "=== LOGS ===",
    logs || "No text logs provided.",
  ].join("\n");

  const text = await ollamaChat({
    baseUrl: input.baseUrl,
    model: input.model,
    timeoutMs: input.timeoutMs,
    retryMaxAttempts: input.retryMaxAttempts,
    retryBaseDelayMs: input.retryBaseDelayMs,
    formatJson: true,
    temperature: 0.2,
    messages: [
      { role: "system", content: ANALYZE_SYSTEM_INSTRUCTION },
      { role: "user", content: userPrompt },
    ],
  });

  const jsonStr = extractJsonBlock(text);
  const raw = tryRepairAndParseJson(jsonStr) as any;
  const rawConfidence = Number(raw.confidenceScore);
  const confidenceScore = Number.isFinite(rawConfidence) ? clampNumber(Math.round(rawConfidence), 0, 100) : 50;

  return {
    title: asString(raw.title, "Untitled Incident", 180),
    summary: asString(raw.summary, "No summary available.", 4_000),
    severity: ["SEV1", "SEV2", "SEV3"].includes(raw.severity) ? raw.severity : "UNKNOWN",
    rootCauses: asStringArray(raw.rootCauses, 12, 500),
    reasoning: asString(raw.reasoning, "", 6_000),
    confidenceScore,
    timeline: normalizeTimeline(raw.timeline),
    actionItems: normalizeActionItems(raw.actionItems),
    mitigationSteps: asStringArray(raw.mitigationSteps, 20, 500),
    impact: typeof raw.impact === "object" && raw.impact !== null ? raw.impact : {},
    tags: asStringArray(raw.tags, 20, 60).map((t) => t.toLowerCase()),
    lessonsLearned: asString(raw.lessonsLearned, "", 2_000),
    preventionRecommendations: asStringArray(raw.preventionRecommendations, 20, 500),
    references: [],
  };
}

export async function ollamaFollowUp(input: {
  baseUrl: string;
  model: string;
  report: IncidentReport;
  history: { role: "user" | "assistant"; content: string }[];
  question: string;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<string> {
  const contextStr = [
    "[Incident Context]",
    `Title: ${input.report.title}`,
    `Severity: ${input.report.severity}`,
    `Summary: ${input.report.summary}`,
    `Root Causes: ${(input.report.rootCauses || []).join(", ")}`,
    `Reasoning: ${input.report.reasoning || ""}`,
    "",
    "Answer as an SRE assistant. Use concise, practical language.",
  ].join("\n");

  const historyLines = (input.history || [])
    .slice(-20)
    .map((h) => `${h.role.toUpperCase()}: ${String(h.content || "").trim().slice(0, 4_000)}`)
    .join("\n");

  const prompt = [contextStr, historyLines ? `\n[Conversation]\n${historyLines}` : "", `\n[Question]\n${input.question}`]
    .filter(Boolean)
    .join("\n");

  const text = await ollamaChat({
    baseUrl: input.baseUrl,
    model: input.model,
    timeoutMs: input.timeoutMs,
    retryMaxAttempts: input.retryMaxAttempts,
    retryBaseDelayMs: input.retryBaseDelayMs,
    temperature: 0.2,
    messages: [
      { role: "system", content: "You are a helpful SRE assistant for incident response." },
      { role: "user", content: prompt },
    ],
  });

  return asString(text, "No answer generated.", 8_000) || "No answer generated.";
}
