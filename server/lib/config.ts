export type DemoMode = "demo" | "live";

export type GroundingDefault = boolean;

export interface ServerConfig {
  port: number;
  mode: DemoMode;
  geminiApiKey?: string;
  maxImages: number;
  maxLogChars: number;
  groundingDefault: GroundingDefault;
  modelAnalyze: string;
  modelTts: string;
}

function readInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

export function loadConfig(): ServerConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const mode: DemoMode = geminiApiKey ? "live" : "demo";

  return {
    port: readInt("PORT", 8787),
    mode,
    geminiApiKey: geminiApiKey || undefined,
    maxImages: readInt("MAX_IMAGES", 8),
    maxLogChars: readInt("MAX_LOG_CHARS", 50_000),
    groundingDefault: readBool("GROUNDING_DEFAULT", false),
    modelAnalyze: (process.env.GEMINI_MODEL_ANALYZE?.trim() || "gemini-3-pro-preview"),
    modelTts: (process.env.GEMINI_MODEL_TTS?.trim() || "gemini-2.5-flash-preview-tts"),
  };
}

