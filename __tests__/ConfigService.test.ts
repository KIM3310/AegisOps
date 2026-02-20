import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../server/lib/config";

const BASE_ENV = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  process.env = { ...BASE_ENV, ...values };
}

afterEach(() => {
  process.env = { ...BASE_ENV };
});

describe("loadConfig", () => {
  it("uses safe defaults when env is unset", () => {
    setEnv({
      LLM_PROVIDER: undefined,
      GEMINI_API_KEY: undefined,
      PORT: undefined,
      HOST: undefined,
      GEMINI_TIMEOUT_MS: undefined,
      GEMINI_RETRY_MAX_ATTEMPTS: undefined,
      GEMINI_RETRY_BASE_DELAY_MS: undefined,
      REQUEST_BODY_LIMIT_MB: undefined,
      MAX_IMAGES: undefined,
      MAX_IMAGE_BYTES: undefined,
      MAX_LOG_CHARS: undefined,
      MAX_QUESTION_CHARS: undefined,
      MAX_TTS_CHARS: undefined,
      ANALYZE_CACHE_TTL_SEC: undefined,
      ANALYZE_CACHE_MAX_ENTRIES: undefined,
      GROUNDING_DEFAULT: undefined,
      TRUST_PROXY: undefined,
      OLLAMA_BASE_URL: undefined,
      OLLAMA_MODEL_ANALYZE: undefined,
      OLLAMA_MODEL_FOLLOWUP: undefined,
      OLLAMA_MODEL: undefined,
    });

    const cfg = loadConfig();

    expect(cfg.mode).toBe("demo");
    expect(cfg.llmProvider).toBe("auto");
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8787);
    expect(cfg.geminiTimeoutMs).toBe(45_000);
    expect(cfg.geminiRetryMaxAttempts).toBe(3);
    expect(cfg.geminiRetryBaseDelayMs).toBe(400);
    expect(cfg.requestBodyLimitMb).toBe(25);
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.maxImages).toBe(8);
    expect(cfg.maxImageBytes).toBe(5_000_000);
    expect(cfg.maxLogChars).toBe(50_000);
    expect(cfg.maxQuestionChars).toBe(4_000);
    expect(cfg.maxTtsChars).toBe(5_000);
    expect(cfg.analyzeCacheTtlSec).toBe(300);
    expect(cfg.analyzeCacheMaxEntries).toBe(200);
    expect(cfg.groundingDefault).toBe(false);
    expect(cfg.ollamaBaseUrl).toBe("http://127.0.0.1:11434");
    expect(cfg.ollamaModelAnalyze).toBe("llama3.1:8b");
    expect(cfg.ollamaModelFollowUp).toBe("llama3.1:8b");
  });

  it("clamps numeric env values to safe bounds", () => {
    setEnv({
      LLM_PROVIDER: "gemini",
      PORT: "-1",
      HOST: "0.0.0.0",
      GEMINI_TIMEOUT_MS: "999999",
      GEMINI_RETRY_MAX_ATTEMPTS: "0",
      GEMINI_RETRY_BASE_DELAY_MS: "99999",
      REQUEST_BODY_LIMIT_MB: "0",
      MAX_IMAGES: "999",
      MAX_IMAGE_BYTES: "1",
      MAX_LOG_CHARS: "20",
      MAX_QUESTION_CHARS: "10",
      MAX_TTS_CHARS: "999999",
      ANALYZE_CACHE_TTL_SEC: "-1",
      ANALYZE_CACHE_MAX_ENTRIES: "999999",
      GEMINI_API_KEY: "test-key",
      GROUNDING_DEFAULT: "true",
      TRUST_PROXY: "true",
    });

    const cfg = loadConfig();

    expect(cfg.mode).toBe("live");
    expect(cfg.llmProvider).toBe("gemini");
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(1);
    expect(cfg.geminiTimeoutMs).toBe(180_000);
    expect(cfg.geminiRetryMaxAttempts).toBe(1);
    expect(cfg.geminiRetryBaseDelayMs).toBe(5_000);
    expect(cfg.requestBodyLimitMb).toBe(1);
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.maxImages).toBe(16);
    expect(cfg.maxImageBytes).toBe(100_000);
    expect(cfg.maxLogChars).toBe(1_000);
    expect(cfg.maxQuestionChars).toBe(200);
    expect(cfg.maxTtsChars).toBe(20_000);
    expect(cfg.analyzeCacheTtlSec).toBe(0);
    expect(cfg.analyzeCacheMaxEntries).toBe(5_000);
    expect(cfg.groundingDefault).toBe(true);
  });

  it("supports ollama mode without Gemini API key", () => {
    setEnv({
      LLM_PROVIDER: "ollama",
      GEMINI_API_KEY: undefined,
      OLLAMA_BASE_URL: "http://127.0.0.1:11434/",
      OLLAMA_MODEL: "llama3.2",
      OLLAMA_MODEL_ANALYZE: undefined,
      OLLAMA_MODEL_FOLLOWUP: undefined,
    });

    const cfg = loadConfig();

    expect(cfg.mode).toBe("live");
    expect(cfg.llmProvider).toBe("ollama");
    expect(cfg.ollamaBaseUrl).toBe("http://127.0.0.1:11434");
    expect(cfg.ollamaModelAnalyze).toBe("llama3.2");
    expect(cfg.ollamaModelFollowUp).toBe("llama3.2");
  });
});
