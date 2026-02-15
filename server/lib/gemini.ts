import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
import type { IncidentReport, ReferenceSource } from "../../types";
import { extractJsonBlock, tryRepairAndParseJson } from "./json";

type ImageInput = { mimeType: string; data: string };

function clampText(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 20))}\n\n...[truncated ${t.length - max} chars]`;
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

      const response = await ai.models.generateContent({
        model: input.model,
        contents: { parts },
        config: cfg,
      });

      const text = (await getResponseText(response)).trim();
      if (!text) throw new Error("Empty response from model.");

      const jsonStr = extractJsonBlock(text);
      const raw = tryRepairAndParseJson(jsonStr) as any;

      const report: IncidentReport = {
        title: raw.title || "Untitled Incident",
        summary: raw.summary || "No summary available.",
        severity: ["SEV1", "SEV2", "SEV3"].includes(raw.severity) ? raw.severity : "UNKNOWN",
        rootCauses: Array.isArray(raw.rootCauses) ? raw.rootCauses : [],
        reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
        confidenceScore: typeof raw.confidenceScore === "number" ? raw.confidenceScore : 50,
        timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
        actionItems: Array.isArray(raw.actionItems) ? raw.actionItems : [],
        mitigationSteps: Array.isArray(raw.mitigationSteps) ? raw.mitigationSteps : [],
        impact: raw.impact || {},
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        lessonsLearned: raw.lessonsLearned || "",
        preventionRecommendations: Array.isArray(raw.preventionRecommendations) ? raw.preventionRecommendations : [],
      };

      // Grounding references (only if enabled and present)
      const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const references: ReferenceSource[] = chunks
        .map((c: any) => (c.web ? { title: c.web.title, uri: c.web.uri } : null))
        .filter((r: any) => r !== null);

      if (references.length > 0) report.references = references;

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

  const response = await ai.models.generateContent({
    model: input.model,
    contents,
    config: cfg,
  });

  const text = (await getResponseText(response)).trim();
  return text || "No answer generated.";
}

export async function geminiTts(input: {
  apiKey: string;
  model: string;
  text: string;
}): Promise<string | undefined> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  if (!input.text?.trim()) return undefined;

  const response = await ai.models.generateContent({
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
  });

  return response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}
