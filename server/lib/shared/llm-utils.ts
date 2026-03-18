/**
 * Shared utility functions used by both Ollama and Gemini LLM providers.
 */

export function clampText(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 20))}\n\n...[truncated ${t.length - max} chars]`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function asMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message || "";
  return String(error);
}

export function asString(value: unknown, fallback = "", maxChars = 2_000): string {
  const v = typeof value === "string" ? value : fallback;
  return clampText(v, maxChars);
}

export function asStringArray(value: unknown, maxItems = 12, maxChars = 400): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((x) => asString(x, "", maxChars))
    .filter((x) => x.length > 0);
}

export type ImageInput = { mimeType: string; data: string };
