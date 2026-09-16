import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { describeIfSocketBinding } from "./socketBinding";

const operatorToken = "synthetic-operator-test-token";
const providerKey = "sk-synthetic-provider-test-not-real";
const geminiKey = "synthetic-gemini-key-not-real";
const providerBaseUrl = "https://synthetic-user:synthetic-password@example.invalid/v1?token=synthetic-query#synthetic-fragment";
const providerReferer = "https://example.invalid/review?auth=synthetic-referer-query#synthetic-referer-fragment";
const sessionId = "synthetic-private-session";
const privateQuestion = "SYNTHETIC_PRIVATE_QUESTION_DO_NOT_DISCLOSE";
const privateReadPaths = [
  "/api/live-sessions",
  "/api/live-sessions/synthetic-private-session",
  "/api/live-sessions/synthetic-private-session/export",
  "/api/runtime/scorecard",
  "/api/postmortem-pack",
  "/api/live-session-pack",
  "/api/summary-pack",
  "/api/system-design-pack",
  "/api/export-bundle",
  "/api/export-bundle/verify",
  "/api/escalation-readiness",
  "/api/cloud-proof",
  "/api/meta",
  "/api/evals/replays",
  "/api/evals/replays/summary",
  "/api/evals/providers",
  "/api/analytics/severity-trend",
  "/api/integrations/status",
  "/api/resource-pack",
  "/api/schema/report",
  "/api/settings/api-key",
  "/api/metrics",
];

describeIfSocketBinding("configured operator API read boundary", () => {
  let server: Server;
  let baseUrl = "";
  const directory = mkdtempSync(join(tmpdir(), "aegisops-operator-reads-"));
  const operatorHeaders = { "x-operator-token": operatorToken };

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "demo");
    vi.stubEnv("AEGISOPS_OPERATOR_TOKEN", operatorToken);
    vi.stubEnv("AEGISOPS_OPERATOR_ALLOWED_ROLES", "");
    vi.stubEnv("AEGISOPS_OPERATOR_OIDC_ISSUER", "");
    vi.stubEnv("AEGISOPS_OPERATOR_OIDC_AUDIENCE", "");
    vi.stubEnv("AEGISOPS_SESSION_STORE_PATH", join(directory, "sessions.jsonl"));
    vi.stubEnv("AEGISOPS_RUNTIME_STORE_PATH", join(directory, "runtime.jsonl"));
    vi.stubEnv("GEMINI_API_KEY", geminiKey);
    vi.stubEnv("API_KEY_SETTINGS_TOKEN", "");
    vi.stubEnv("OPENAI_API_KEY", providerKey);
    vi.stubEnv("OPENAI_BASE_URL", providerBaseUrl);
    vi.stubEnv("OPENROUTER_BASE_URL", providerBaseUrl);
    vi.stubEnv("OPENROUTER_HTTP_REFERER", providerReferer);
    vi.stubEnv("OPENROUTER_MODEL", "synthetic-test-model");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL_PUBLIC", "synthetic-test-model");
    vi.stubEnv("OPENAI_KILL_SWITCH", "true");
    const { app } = await import("../server/index");
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const analyze = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { ...operatorHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        logs: "[2026-09-16T00:00:00Z] ERROR: Synthetic checkout error",
        images: [],
      }),
    });
    const report = await analyze.json();
    expect(analyze.status).toBe(200);
    const followup = await fetch(`${baseUrl}/api/followup`, {
      method: "POST",
      headers: { ...operatorHeaders, "content-type": "application/json" },
      body: JSON.stringify({ sessionId, question: privateQuestion, report }),
    });
    expect(followup.status).toBe(200);
    expect((await followup.json()).answer).toContain(privateQuestion);
  });

  beforeEach(() => {
    vi.stubEnv("AEGISOPS_OPERATOR_TOKEN", operatorToken);
    vi.stubEnv("AEGISOPS_OPERATOR_ALLOWED_ROLES", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(privateReadPaths)("requires a valid operator for GET %s", async (path) => {
    const deniedHeaders: Record<string, string>[] = [{}, { "x-operator-token": "wrong-synthetic-token" }];
    for (const headers of deniedHeaders) {
      const denied = await fetch(`${baseUrl}${path}`, { headers });
      const deniedText = await denied.text();
      expect(denied.status).toBe(403);
      expect(deniedText).not.toContain(privateQuestion);
      expect(deniedText).not.toContain(sessionId);
      expect(deniedText).not.toContain(providerKey);
    }

    const allowed = await fetch(`${baseUrl}${path}`, { headers: operatorHeaders });
    const allowedText = await allowed.text();
    expect(allowed.status).toBe(200);
    expect(allowedText).not.toContain(providerKey);
    expect(allowedText).not.toContain(geminiKey);
    expect(allowedText).not.toContain(providerBaseUrl);
    if (path === `/api/live-sessions/${sessionId}` || path.endsWith(`/${sessionId}/export`)) {
      expect(allowedText).toContain(privateQuestion);
    }
  });

  it.each([
    ["openai", "/api/healthz"],
    ["openai", "/api/meta"],
    ["openai", "/api/settings/api-key"],
    ["openrouter", "/api/healthz"],
    ["openrouter", "/api/meta"],
    ["openrouter", "/api/settings/api-key"],
  ])("omits %s secrets and provider URLs from %s", async (gateway, path) => {
    vi.stubEnv("OPENROUTER_API_KEY", gateway === "openrouter" ? providerKey : "");
    const response = await fetch(`${baseUrl}${path}`, {
      headers: path === "/api/healthz" ? {} : operatorHeaders,
    });
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    for (const marker of [
      providerKey, geminiKey, providerBaseUrl, providerReferer,
      "synthetic-user", "synthetic-password", "synthetic-query", "synthetic-fragment",
      "synthetic-referer-query", "synthetic-referer-fragment",
    ]) {
      expect(text).not.toContain(marker);
    }
    if (path === "/api/settings/api-key") {
      expect(body).toMatchObject({ configured: true, masked: "synt...real", persisted: false });
    } else {
      expect(body.openai).not.toHaveProperty("apiKey");
      expect(body.openai).not.toHaveProperty("baseUrl");
      expect(body.openai).not.toHaveProperty("httpReferer");
      expect(body.openai).toMatchObject({
        configured: true,
        gateway,
        liveModel: "synthetic-test-model",
        publicLiveApi: false,
      });
    }
  });

  it("keeps health and session bootstrap public without disclosing stored evidence", async () => {
    const health = await fetch(`${baseUrl}/api/healthz`);
    const healthText = await health.text();
    expect(health.status).toBe(200);
    expect(JSON.parse(healthText).status).toBe("ok");
    expect(healthText).not.toContain(providerKey);
    expect(healthText).not.toContain(privateQuestion);

    const session = await fetch(`${baseUrl}/api/auth/session`);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ active: false, session: null });
    const invalidLogin = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authMode: "token", credential: "wrong-synthetic-token" }),
    });
    expect(invalidLogin.status).toBe(403);
    await invalidLogin.text();

    const login = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authMode: "token", credential: operatorToken }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(login.status).toBe(200);
    expect((await login.json()).active).toBe(true);
    for (const path of [`/api/live-sessions/${sessionId}`, `/api/live-sessions/${sessionId}/export`]) {
      const detail = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      expect(detail.status).toBe(200);
      expect(await detail.text()).toContain(privateQuestion);
    }
    const settings = await fetch(`${baseUrl}/api/settings/api-key`, { headers: { cookie } });
    expect(settings.status).toBe(200);
    expect(await settings.json()).toMatchObject({ configured: true, masked: "synt...real" });

    const logout = await fetch(`${baseUrl}/api/auth/session`, { method: "DELETE" });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    await logout.text();
  });

  it.each(["/api/healthz/", "/API/HEALTHZ", "/api/auth/session/", "/API/AUTH/SESSION"])(
    "preserves the public route exception for %s", async (path) => {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
    }
  );

  it("accepts a static bearer token for an evidence export", async () => {
    const response = await fetch(`${baseUrl}/api/live-sessions/${sessionId}/export`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(privateQuestion);
  });

  it("requires the configured role on private reads", async () => {
    vi.stubEnv("AEGISOPS_OPERATOR_ALLOWED_ROLES", "incident-commander");
    const denied = await fetch(`${baseUrl}/api/live-sessions/${sessionId}`, {
      headers: operatorHeaders,
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.message).toContain("required operator role");
    const allowed = await fetch(`${baseUrl}/api/live-sessions/${sessionId}`, {
      headers: { ...operatorHeaders, "x-operator-role": "incident-commander" },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain(privateQuestion);
  });

  it.each([
    ["HEAD", `/api/live-sessions/${sessionId}`],
    ["GET", `/API/LIVE-SESSIONS/${sessionId}/`],
    ["GET", "/api/auth/session/private"],
    ["GET", "/api/healthz/private"],
    ["POST", "/api/analyze"],
    ["POST", "/api/followup"],
    ["POST", "/api/tts"],
    ["POST", "/api/live-escalation-preview"],
    ["PUT", "/api/settings/api-key"],
    ["DELETE", "/api/settings/api-key"],
  ])("rejects anonymous %s %s before route execution", async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(privateQuestion);
  });

  it("allows preflight without granting access to the private GET", async () => {
    const path = `/api/live-sessions/${sessionId}`;
    const preflight = await fetch(`${baseUrl}${path}`, { method: "OPTIONS" });
    expect(preflight.status).toBe(404);
    await preflight.text();
    const get = await fetch(`${baseUrl}${path}`);
    expect(get.status).toBe(403);
    await get.text();
  });

  it("keeps auth-disabled synthetic reads and writes available", async () => {
    vi.stubEnv("AEGISOPS_OPERATOR_TOKEN", "");
    for (const path of privateReadPaths) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(providerKey);
    }
    const analyze = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logs: "[2026-09-16T00:00:00Z] ERROR: Synthetic demo error", images: [] }),
    });
    expect(analyze.status).toBe(200);
    expect((await analyze.json()).severity).toBe("SEV2");
  });
});
