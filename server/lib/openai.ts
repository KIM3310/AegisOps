import OpenAI from "openai";
import type { IncidentReport } from "../../types";
import { extractJsonBlock, tryRepairAndParseJson } from "./json";
import { clampText, clampNumber, sleep, asMessage, asString, asStringArray } from "./shared/llm-utils";
import type { ImageInput } from "./shared/llm-utils";
import { normalizeTimeline, normalizeActionItems } from "./shared/normalize";

function isRetriableOpenAiError(error: unknown): boolean {
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

async function withRetry<T>(input: {
  label: string;
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  op: () => Promise<T>;
}): Promise<T> {
  const maxAttempts = clampNumber(Number(input.maxAttempts || 1), 1, 6);
  const baseDelayMs = clampNumber(Number(input.baseDelayMs || 400), 50, 5_000);
  const timeoutMs = clampNumber(Number(input.timeoutMs || 45_000), 5_000, 180_000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${input.label} timed out after ${Math.round(timeoutMs / 1000)}s.`)),
          timeoutMs
        );
      });
      try {
        return await Promise.race([input.op(), timeoutPromise]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetriableOpenAiError(error)) {
        throw error;
      }
      const jitter = 0.7 + Math.random() * 0.6;
      const delay = clampNumber(Math.round(baseDelayMs * Math.pow(2, attempt - 1) * jitter), 50, 10_000);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${input.label} failed.`);
}

const SYSTEM_INSTRUCTION = `You are a Principal SRE. Analyze incident logs and monitoring screenshots and produce a decision-ready post-incident report.

Rules:
- Do not invent facts or metrics. If the data is missing, write "Unknown" or "Investigation Needed".
- Output ONLY raw valid JSON. No markdown fences, no commentary.
- The "reasoning" field must be a concise reasoning trace with clear sections:
  "Observations", "Hypotheses", "Decision Path". Keep it short and evidence-based.

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

function buildUserContent(
  logs: string,
  images: ImageInput[]
): OpenAI.Chat.ChatCompletionContentPart[] {
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `=== LOGS ===\n${logs || "No text logs provided."}\n\n${
        images.length > 0 ? `[Attached screenshots: ${images.length}]` : ""
      }`,
    },
  ];

  for (const img of images) {
    if (!img?.data) continue;
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mimeType || "image/png"};base64,${img.data}`,
        detail: "low",
      },
    });
  }

  return parts;
}

export async function openaiAnalyzeIncident(input: {
  apiKey: string;
  model: string;
  logs: string;
  images: ImageInput[];
  maxLogChars: number;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<IncidentReport> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const logs = clampText(input.logs, input.maxLogChars);
  const userContent = buildUserContent(logs, input.images);

  const response = await withRetry({
    label: "OpenAI analyze request",
    timeoutMs: input.timeoutMs,
    maxAttempts: input.retryMaxAttempts,
    baseDelayMs: input.retryBaseDelayMs,
    op: () =>
      client.chat.completions.create({
        model: input.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: userContent },
        ],
      }),
  });

  const text = (response.choices[0]?.message?.content || "").trim();
  if (!text) throw new Error("Empty response from OpenAI model.");

  const jsonStr = extractJsonBlock(text);
  const raw = tryRepairAndParseJson(jsonStr) as any;
  const rawConfidence = Number(raw.confidenceScore);
  const confidenceScore = Number.isFinite(rawConfidence)
    ? clampNumber(Math.round(rawConfidence), 0, 100)
    : 50;

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

export async function openaiFollowUp(input: {
  apiKey: string;
  model: string;
  report: IncidentReport;
  history: { role: "user" | "assistant"; content: string }[];
  question: string;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey });

  const contextStr = [
    "[Incident Context]",
    `Title: ${input.report.title}`,
    `Severity: ${input.report.severity}`,
    `Summary: ${input.report.summary}`,
    `Root Causes: ${(input.report.rootCauses || []).join(", ")}`,
    `Reasoning: ${input.report.reasoning || ""}`,
    "",
    "You are a helpful SRE assistant answering questions about this specific incident.",
  ].join("\n");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: contextStr },
    ...(input.history || []).map(
      (m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })
    ),
    { role: "user", content: input.question },
  ];

  const response = await withRetry({
    label: "OpenAI follow-up request",
    timeoutMs: input.timeoutMs,
    maxAttempts: input.retryMaxAttempts,
    baseDelayMs: input.retryBaseDelayMs,
    op: () =>
      client.chat.completions.create({
        model: input.model,
        temperature: 0.2,
        messages,
      }),
  });

  const text = (response.choices[0]?.message?.content || "").trim();
  return asString(text, "No answer generated.", 8_000) || "No answer generated.";
}
