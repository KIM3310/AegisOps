import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeIncident, fetchHealthz, fetchReplayEvalOverview, fetchReportSchema, fetchServiceMeta } from "../services/geminiService";

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
          service: "aegisops-api",
          status: "ok",
          mode: "demo",
          limits: { maxImages: 8, maxLogChars: 1000 },
          defaults: { grounding: false },
          models: { analyze: "x", tts: "y" },
          links: { apiKey: "/api/settings/api-key" },
          diagnostics: { nextAction: "configure Gemini API key or switch to Ollama for live incident analysis." },
          ops_contract: { schema: "ops-envelope-v1", version: 1, required_fields: ["service", "status", "diagnostics.nextAction"] },
          capabilities: ["incident-analysis"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const payload = await fetchHealthz();
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("aegisops-api");
    expect(payload.mode).toBe("demo");
    expect(payload.links?.apiKey).toBe("/api/settings/api-key");
    expect(payload.diagnostics?.nextAction).toContain("configure Gemini API key");
    expect(payload.ops_contract?.schema).toBe("ops-envelope-v1");
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

  it("falls back to a static demo health payload when /api resolves to HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>app shell</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const payload = await fetchHealthz();
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("demo");
    expect(payload.deployment).toBe("static-demo");
    expect(payload.service).toBe("aegisops-static-demo");
  });

  it("falls back to deterministic local incident analysis when the API is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>app shell</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const payload = await analyzeIncident(
      `[2025-01-15T14:30:00Z] WARN: Response time increased: 850ms - approaching SLO threshold
[2025-01-15T14:30:30Z] ERROR: Response time: 3500ms - SLO BREACH DETECTED
[2025-01-15T14:31:00Z] ERROR: Request queue depth: 5000 (limit: 1000)`,
      []
    );

    expect(payload.severity).toBe("SEV1");
    expect(payload.timeline.length).toBeGreaterThan(0);
    expect(payload.reasoning).toContain("Observations");
  });

  it("loads replay eval telemetry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          suiteId: "incident-replay-v1",
          generatedAt: "2026-03-07T00:00:00.000Z",
          summary: {
            totalCases: 4,
            totalChecks: 32,
            passedChecks: 32,
            passRate: 100,
            casesPassingAll: 4,
            severityAccuracy: 100,
          },
          buckets: [],
          cases: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const payload = await fetchReplayEvalOverview();
    expect(payload.summary.totalChecks).toBe(32);
    expect(payload.summary.passRate).toBe(100);
  });

  it("loads service meta telemetry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          service: "aegisops-service-meta",
          version: 1,
          deployment: "backend",
          product: {
            name: "AegisOps",
            category: "multimodal incident copilot",
            headline: "Turn logs, screenshots, and alerts into a reviewable incident report.",
          },
          workflow: ["collect", "reason", "decide", "communicate"],
          runtimeModes: [],
          replaySuite: {
            suiteId: "incident-replay-v1",
            totalCases: 4,
            totalChecks: 32,
            passRate: 100,
            severityAccuracy: 100,
          },
          reportContract: {
            schemaId: "incident-report-v1",
            requiredFields: ["title", "summary"],
            exportFormats: ["json"],
          },
          operatorChecklist: [],
          models: {
            analyze: "gemini-3-pro-preview",
            tts: "gemini-2.5-flash-preview-tts",
          },
          links: {
            healthz: "/api/healthz",
            replayEvals: "/api/evals/replays",
            reportSchema: "/api/schema/report",
            readme: "https://github.com/KIM3310/AegisOps",
            demo: "https://aegisops-ai-incident-doctor.pages.dev",
            video: "https://youtu.be/FOcjPcMheIg",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const payload = await fetchServiceMeta();
    expect(payload.product.name).toBe("AegisOps");
    expect(payload.replaySuite.totalChecks).toBe(32);
    expect(payload.reportContract.schemaId).toBe("incident-report-v1");
  });

  it("loads report schema guidance", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          schemaId: "incident-report-v1",
          version: 1,
          description: "Structured report",
          requiredFields: ["title", "summary", "severity"],
          optionalFields: ["references"],
          exportFormats: ["json", "markdown"],
          fieldGuide: [{ key: "severity", type: "enum", guidance: "Operational urgency" }],
          inputLimits: {
            maxImages: 16,
            maxLogChars: 50000,
            maxQuestionChars: 4000,
            maxTtsChars: 0,
          },
          operatorRules: ["Prefer logs plus screenshots together when available."],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const payload = await fetchReportSchema();
    expect(payload.requiredFields).toContain("severity");
    expect(payload.fieldGuide[0].key).toBe("severity");
  });

  it("falls back to local replay telemetry when the backend is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>app shell</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const payload = await fetchReplayEvalOverview();
    expect(payload.summary.totalChecks).toBe(32);
    expect(payload.summary.passRate).toBe(100);
    expect(payload.cases).toHaveLength(4);
  });

  it("falls back to static service meta when the backend is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>app shell</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const payload = await fetchServiceMeta();
    expect(payload.deployment).toBe("static-demo");
    expect(payload.product.name).toBe("AegisOps");
    expect(payload.reportContract.schemaId).toBe("incident-report-v1");
  });

  it("falls back to static report schema when the backend is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>app shell</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const payload = await fetchReportSchema();
    expect(payload.schemaId).toBe("incident-report-v1");
    expect(payload.requiredFields).toContain("timeline");
  });
});
