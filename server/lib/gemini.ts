import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
import type { IncidentReport, ReferenceSource } from "../../types";
import { extractJsonBlock, tryRepairAndParseJson } from "./json";
import { clampText, clampNumber, sleep, asMessage, asString, asStringArray } from "./shared/llm-utils";
import type { ImageInput } from "./shared/llm-utils";
import { normalizeTimeline, normalizeActionItems } from "./shared/normalize";

function isRetriableGeminiError(error: unknown): boolean {
  const msg = asMessage(error).toLowerCase();
  if (!msg) return false;
  const patterns = [
    " 429",
    "429 ",
    "(429)",
    "rate limit",
    "resource exhausted",
    "internal error",
    "unavailable",
    "temporarily unavailable",
    "timeout",
    "timed out",
    "deadline exceeded",
    "network",
    "econnreset",
    "socket hang up",
    "503",
    "502",
    "504",
  ];
  return patterns.some((p) => msg.includes(p));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const ms = clampNumber(Number(timeoutMs || 45_000), 5_000, 180_000);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms);
    });
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(input.op(), input.timeoutMs, input.label);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetriableGeminiError(error)) {
        throw error;
      }
      const jitter = 0.7 + Math.random() * 0.6;
      const delay = clampNumber(Math.round(baseDelayMs * Math.pow(2, attempt - 1) * jitter), 50, 10_000);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${input.label} failed.`);
}

async function getResponseText(response: any): Promise<string> {
  if (!response) return "";
  if (typeof response.text === "function") {
    const v = response.text();
    return (typeof v?.then === "function" ? await v : v) || "";
  }
  return response.text || "";
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

// Prefer not to disable safety completely. Technical logs may contain "kill"/"attack" etc;
// allow only high-confidence blocks.
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export async function geminiAnalyzeIncident(input: {
  apiKey: string;
  model: string;
  logs: string;
  images: ImageInput[];
  enableGrounding: boolean;
  maxLogChars: number;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<IncidentReport> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const logs = clampText(input.logs, input.maxLogChars);

  const parts: any[] = [
    {
      text: `=== LOGS ===\n${logs || "No text logs provided."}\n\n${
        input.images.length > 0 ? `[Attached screenshots: ${input.images.length}]` : ""
      }`,
    },
  ];

  for (const img of input.images) {
    if (!img?.data) continue;
    parts.push({ inlineData: { mimeType: img.mimeType || "image/png", data: img.data } });
  }

  const strategies = [
    { temperature: 0.2, topK: 30 },
    { temperature: 0.4, topK: 40 },
  ];

  for (let attempt = 0; attempt < strategies.length; attempt++) {
    try {
      const cfg: any = {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: strategies[attempt].temperature,
        topK: strategies[attempt].topK,
        safetySettings: SAFETY_SETTINGS,
      };
      if (input.enableGrounding) cfg.tools = [{ googleSearch: {} }];

      const response = await withRetry({
        label: "Gemini analyze request",
        timeoutMs: input.timeoutMs,
        maxAttempts: input.retryMaxAttempts,
        baseDelayMs: input.retryBaseDelayMs,
        op: () =>
          ai.models.generateContent({
            model: input.model,
            contents: { parts },
            config: cfg,
          }),
      });

      const text = (await getResponseText(response)).trim();
      if (!text) throw new Error("Empty response from model.");

      const jsonStr = extractJsonBlock(text);
      const raw = tryRepairAndParseJson(jsonStr) as any;
      const rawConfidence = Number(raw.confidenceScore);
      const confidenceScore = Number.isFinite(rawConfidence)
        ? clampNumber(Math.round(rawConfidence), 0, 100)
        : 50;

      const report: IncidentReport = {
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
      };

      // Grounding references (only if enabled and present)
      const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const references: ReferenceSource[] = chunks
        .map((c: any) => (c.web ? { title: c.web.title, uri: c.web.uri } : null))
        .filter((r: any) => r !== null)
        .filter((r: any) => typeof r.uri === "string" && r.uri.trim().length > 0)
        .map((r: any) => ({
          title: asString(r.title, "Reference", 180),
          uri: asString(r.uri, "", 1_000),
        }))
        .filter((r: ReferenceSource) => r.uri.length > 0);

      const dedupedReferences = Array.from(new Map(references.map((r) => [r.uri, r])).values()).slice(0, 20);

      if (dedupedReferences.length > 0) report.references = dedupedReferences;

      return report;
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (attempt === strategies.length - 1) throw new Error(msg);
    }
  }

  throw new Error("Unexpected execution path");
}

export async function geminiFollowUp(input: {
  apiKey: string;
  model: string;
  report: IncidentReport;
  history: { role: "user" | "assistant"; content: string }[];
  question: string;
  enableGrounding: boolean;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });

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

  const contents: any[] = [
    { role: "user", parts: [{ text: contextStr }] },
    { role: "model", parts: [{ text: "Understood. Ask me anything about this incident." }] },
    ...(input.history || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: input.question }] },
  ];

  const cfg: any = { safetySettings: SAFETY_SETTINGS };
  if (input.enableGrounding) cfg.tools = [{ googleSearch: {} }];

  const response = await withRetry({
    label: "Gemini follow-up request",
    timeoutMs: input.timeoutMs,
    maxAttempts: input.retryMaxAttempts,
    baseDelayMs: input.retryBaseDelayMs,
    op: () =>
      ai.models.generateContent({
        model: input.model,
        contents,
        config: cfg,
      }),
  });

  const text = (await getResponseText(response)).trim();
  return asString(text, "No answer generated.", 8_000) || "No answer generated.";
}

export async function geminiTts(input: {
  apiKey: string;
  model: string;
  text: string;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}): Promise<string | undefined> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  if (!input.text?.trim()) return undefined;

  const response = await withRetry({
    label: "Gemini TTS request",
    timeoutMs: input.timeoutMs,
    maxAttempts: input.retryMaxAttempts,
    baseDelayMs: input.retryBaseDelayMs,
    op: () =>
      ai.models.generateContent({
        model: input.model,
        contents: [
          {
            parts: [
              {
                text: `You are a professional SRE. Provide a concise audio briefing.
Instructions: Speak naturally, ignore markdown symbols, and focus on the core issue.
Summary: "${input.text.trim()}"`,
              },
            ],
          },
        ],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
          safetySettings: SAFETY_SETTINGS,
        },
      }),
  });

  return response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}
