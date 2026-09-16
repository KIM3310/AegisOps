import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { describeIfSocketBinding } from "./socketBinding";

const operatorToken = "synthetic-settings-operator";
const settingsToken = "synthetic-settings-policy-token";

describeIfSocketBinding.each(["ollama", "demo"])("operator validation before %s settings policy", (provider) => {
  let server: Server;
  let baseUrl = "";
  const directory = mkdtempSync(join(tmpdir(), "aegisops-settings-order-"));

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("LLM_PROVIDER", provider);
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:1");
    vi.stubEnv("OPENAI_KILL_SWITCH", "true");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("AEGISOPS_OPERATOR_TOKEN", operatorToken);
    vi.stubEnv("AEGISOPS_OPERATOR_ALLOWED_ROLES", "");
    vi.stubEnv("AEGISOPS_OPERATOR_OIDC_ISSUER", "");
    vi.stubEnv("AEGISOPS_OPERATOR_OIDC_AUDIENCE", "");
    vi.stubEnv("API_KEY_SETTINGS_TOKEN", settingsToken);
    vi.stubEnv("ALLOW_REMOTE_API_KEY_SETTINGS", "false");
    vi.stubEnv("AEGISOPS_SESSION_STORE_PATH", join(directory, "sessions.jsonl"));
    vi.stubEnv("AEGISOPS_RUNTIME_STORE_PATH", join(directory, "runtime.jsonl"));
    const { app } = await import("../server/index");
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  const invalidOperators: Array<{ name: string; headers: Record<string, string> }> = [
    { name: "missing operator and settings tokens", headers: {} },
    {
      name: "wrong operator with valid settings token",
      headers: { "x-operator-token": "wrong-synthetic-operator", "x-api-settings-token": settingsToken },
    },
  ];

  it.each(invalidOperators.flatMap((operator) =>
    ["GET", "PUT", "DELETE"].map((method) => ({ ...operator, method }))
  ))("rejects $name for $method at the operator boundary first", async ({ headers, method }) => {
    const response = await fetch(`${baseUrl}/api/settings/api-key`, { method, headers });
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe("Missing or invalid operator credential for protected API route.");
  });

  it("requires the settings token as well as the operator token for settings reads", async () => {
    const denied = await fetch(`${baseUrl}/api/settings/api-key`, {
      headers: { "x-operator-token": operatorToken },
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.message).toBe("Missing or invalid API key settings token.");

    const allowed = await fetch(`${baseUrl}/api/settings/api-key`, {
      headers: { "x-operator-token": operatorToken, authorization: `Bearer ${settingsToken}` },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      provider,
      configured: provider === "ollama",
      persisted: false,
    });
  });

  it("preserves authorized settings writes without returning the full key", async () => {
    const apiKey = "synthetic-runtime-gemini-key-not-real";
    const headers = {
      authorization: `Bearer ${operatorToken}`,
      "x-api-settings-token": settingsToken,
      "content-type": "application/json",
    };
    const updated = await fetch(`${baseUrl}/api/settings/api-key`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ apiKey }),
    });
    const text = await updated.text();
    expect(text).not.toContain(apiKey);
    if (provider === "ollama") {
      expect(updated.status).toBe(409);
      expect(JSON.parse(text).error.message).toBe("API key settings are disabled while LLM_PROVIDER=ollama.");
    } else {
      expect(updated.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ configured: true, source: "runtime", masked: "synt...real" });
      const settings = await fetch(`${baseUrl}/api/settings/api-key`, { headers });
      expect(settings.status).toBe(200);
      const settingsText = await settings.text();
      expect(settingsText).not.toContain(apiKey);
      expect(JSON.parse(settingsText)).toMatchObject({ configured: true, masked: "synt...real" });
    }

    const removed = await fetch(`${baseUrl}/api/settings/api-key`, { method: "DELETE", headers });
    expect(removed.status).toBe(provider === "ollama" ? 409 : 200);
    if (provider === "demo") {
      expect(await removed.json()).toMatchObject({ configured: false, source: "none" });
    } else {
      expect((await removed.json()).error.message).toBe("API key settings are disabled while LLM_PROVIDER=ollama.");
    }
  });

  it("applies provider and settings-token restrictions only after valid operator auth", async () => {
    for (const token of ["", "wrong-synthetic-settings-token"]) {
      const response = await fetch(`${baseUrl}/api/settings/api-key`, {
        method: "PUT",
        headers: { "x-operator-token": operatorToken, "x-api-settings-token": token },
      });
      const body = await response.json();
      if (provider === "ollama") {
        expect(response.status).toBe(409);
        expect(body.error.message).toBe("API key settings are disabled while LLM_PROVIDER=ollama.");
      } else {
        expect(response.status).toBe(403);
        expect(body.error.message).toBe("Missing or invalid API key settings token.");
      }
    }

    const validTokens = await fetch(`${baseUrl}/api/settings/api-key`, {
      method: "PUT",
      headers: { "x-operator-token": operatorToken, "x-api-settings-token": settingsToken },
    });
    const body = await validTokens.json();
    if (provider === "ollama") {
      expect(validTokens.status).toBe(409);
      expect(body.error.message).toBe("API key settings are disabled while LLM_PROVIDER=ollama.");
    } else {
      expect(validTokens.status).toBe(400);
      expect(body.error.message).toContain("apiKey");
    }
  });
});
