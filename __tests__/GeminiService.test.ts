import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeIncident, fetchHealthz } from "../services/geminiService";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("geminiService apiFetch", () => {
  it("returns parsed JSON for successful responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          mode: "demo",
          limits: { maxImages: 8, maxLogChars: 1000 },
          defaults: { grounding: false },
          models: { analyze: "x", tts: "y" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const payload = await fetchHealthz();
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("demo");
  });

  it("includes request_id from response headers in API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "req-abc123",
        },
      })
    );

    await expect(analyzeIncident("x", [])).rejects.toThrow("request_id=req-abc123");
  });

  it("times out stalled requests", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            (abortError as Error & { name: string }).name = "AbortError";
            reject(abortError);
          });
        }
      });
    });

    const pending = expect(fetchHealthz()).rejects.toThrow("Request timed out");
    await vi.advanceTimersByTimeAsync(31_000);
    await pending;
  });
});
