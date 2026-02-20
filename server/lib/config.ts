export type DemoMode = "demo" | "live";
export type LlmProvider = "auto" | "demo" | "gemini" | "ollama";

export type GroundingDefault = boolean;

export interface ServerConfig {
  host: string;
  port: number;
  mode: DemoMode;
  llmProvider: LlmProvider;
  geminiApiKey?: string;
  geminiTimeoutMs: number;
  geminiRetryMaxAttempts: number;
  geminiRetryBaseDelayMs: number;
  apiKeySettingsToken?: string;
  allowRemoteApiKeySettings: boolean;
  trustProxy: boolean;
  requestBodyLimitMb: number;
  maxImages: number;
  maxImageBytes: number;
  maxLogChars: number;
  maxQuestionChars: number;
  maxTtsChars: number;
  analyzeCacheTtlSec: number;
  analyzeCacheMaxEntries: number;
  groundingDefault: GroundingDefault;
  modelAnalyze: string;
  modelTts: string;
  ollamaBaseUrl: string;
  ollamaModelAnalyze: string;
  ollamaModelFollowUp: string;
}

type IntBounds = {
  min?: number;
  max?: number;
};

function clampInt(value: number, bounds: IntBounds): number {
  let result = value;
  if (typeof bounds.min === "number") result = Math.max(bounds.min, result);
  if (typeof bounds.max === "number") result = Math.min(bounds.max, result);
  return result;
}

function readInt(name: string, fallback: number, bounds: IntBounds = {}): number {
  const v = process.env[name];
  if (!v) return clampInt(fallback, bounds);
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? clampInt(n, bounds) : clampInt(fallback, bounds);
}

function readBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function readProvider(name: string, fallback: LlmProvider): LlmProvider {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (raw === "auto" || raw === "demo" || raw === "gemini" || raw === "ollama") return raw;
  return fallback;
}

function readHost(name: string, fallback: string): string {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return /\s/.test(raw) ? fallback : raw;
}

function readBaseUrl(name: string, fallback: string): string {
  const raw = String(process.env[name] || "").trim();
  const value = raw || fallback;
  if (/\s/.test(value)) return fallback;
  return value.replace(/\/+$/, "");
}

export function loadConfig(): ServerConfig {
  const llmProvider = readProvider("LLM_PROVIDER", "auto");
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const mode: DemoMode =
    llmProvider === "ollama" ? "live" : llmProvider === "demo" ? "demo" : geminiApiKey ? "live" : "demo";
  const modelAnalyze = (process.env.GEMINI_MODEL_ANALYZE?.trim() || "gemini-3-pro-preview");
  const modelTts = (process.env.GEMINI_MODEL_TTS?.trim() || "gemini-2.5-flash-preview-tts");
  const ollamaModelAnalyze =
    process.env.OLLAMA_MODEL_ANALYZE?.trim() || process.env.OLLAMA_MODEL?.trim() || "llama3.1:8b";
  const ollamaModelFollowUp =
    process.env.OLLAMA_MODEL_FOLLOWUP?.trim() || process.env.OLLAMA_MODEL?.trim() || ollamaModelAnalyze;

  return {
    host: readHost("HOST", "127.0.0.1"),
    port: readInt("PORT", 8787, { min: 1, max: 65535 }),
    mode,
    llmProvider,
    geminiApiKey: geminiApiKey || undefined,
    geminiTimeoutMs: readInt("GEMINI_TIMEOUT_MS", 45_000, { min: 5_000, max: 180_000 }),
    geminiRetryMaxAttempts: readInt("GEMINI_RETRY_MAX_ATTEMPTS", 3, { min: 1, max: 6 }),
    geminiRetryBaseDelayMs: readInt("GEMINI_RETRY_BASE_DELAY_MS", 400, { min: 50, max: 5_000 }),
    apiKeySettingsToken: process.env.API_KEY_SETTINGS_TOKEN?.trim() || undefined,
    allowRemoteApiKeySettings: readBool("ALLOW_REMOTE_API_KEY_SETTINGS", false),
    trustProxy: readBool("TRUST_PROXY", false),
    requestBodyLimitMb: readInt("REQUEST_BODY_LIMIT_MB", 25, { min: 1, max: 100 }),
    maxImages: readInt("MAX_IMAGES", 8, { min: 0, max: 16 }),
    maxImageBytes: readInt("MAX_IMAGE_BYTES", 5_000_000, { min: 100_000, max: 20_000_000 }),
    maxLogChars: readInt("MAX_LOG_CHARS", 50_000, { min: 1_000, max: 500_000 }),
    maxQuestionChars: readInt("MAX_QUESTION_CHARS", 4_000, { min: 200, max: 20_000 }),
    maxTtsChars: readInt("MAX_TTS_CHARS", 5_000, { min: 100, max: 20_000 }),
    analyzeCacheTtlSec: readInt("ANALYZE_CACHE_TTL_SEC", 300, { min: 0, max: 86_400 }),
    analyzeCacheMaxEntries: readInt("ANALYZE_CACHE_MAX_ENTRIES", 200, { min: 0, max: 5_000 }),
    groundingDefault: readBool("GROUNDING_DEFAULT", false),
    modelAnalyze,
    modelTts,
    ollamaBaseUrl: readBaseUrl("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    ollamaModelAnalyze,
    ollamaModelFollowUp,
  };
}
